from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
DATA_FILE = APP_DIR / "data.json"


DEFAULT_STATE = {
    "selectedMonth": "",
    "employees": [f"技術者{i:02d}" for i in range(1, 21)],
    "projects": [],
    "entries": [],
}


def normalize_state(value: object) -> dict:
    if not isinstance(value, dict):
        return DEFAULT_STATE.copy()

    employees = value.get("employees")
    projects = value.get("projects")
    entries = value.get("entries")
    normalized_entries = normalize_entries(entries)
    normalized_projects = []
    if isinstance(projects, list):
        normalized_projects.extend(str(project) for project in projects if str(project))
    normalized_projects.extend(entry["project"] for entry in normalized_entries if entry["project"])

    return {
        "selectedMonth": value.get("selectedMonth") if isinstance(value.get("selectedMonth"), str) else "",
        "employees": employees if isinstance(employees, list) and employees else DEFAULT_STATE["employees"],
        "projects": list(dict.fromkeys(normalized_projects)),
        "entries": normalized_entries,
    }


def normalize_entries(entries: object) -> list[dict]:
    if not isinstance(entries, list):
        return []

    normalized = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        date = entry.get("date") if isinstance(entry.get("date"), str) else ""
        employee = entry.get("employee") if isinstance(entry.get("employee"), str) else ""
        project = entry.get("project") or entry.get("task") or ""
        has_split_hours = any(key in entry for key in ("regularHours", "overtimeHours", "regular_hours", "overtime_hours"))
        regular_value = entry.get("regularHours", entry.get("regular_hours", 0)) if has_split_hours else entry.get("hours", 0)
        overtime_value = entry.get("overtimeHours", entry.get("overtime_hours", 0)) if has_split_hours else 0
        regular_hours = to_non_negative_number(regular_value)
        overtime_hours = to_non_negative_number(overtime_value)
        if date and employee and project:
            normalized.append(
                {
                    "id": entry.get("id") if isinstance(entry.get("id"), str) else "",
                    "date": date,
                    "employee": employee,
                    "project": str(project),
                    "regularHours": regular_hours,
                    "overtimeHours": overtime_hours,
                    "hours": regular_hours + overtime_hours,
                }
            )
    return normalized


def to_non_negative_number(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) and number >= 0 else 0.0


def read_state() -> dict:
    if not DATA_FILE.exists():
        return DEFAULT_STATE.copy()

    try:
        return normalize_state(json.loads(DATA_FILE.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return DEFAULT_STATE.copy()


def write_state(state: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    backup_legacy_data_file()
    fd, temp_name = tempfile.mkstemp(prefix="data-", suffix=".json", dir=DATA_FILE.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(normalize_state(state), handle, ensure_ascii=False, indent=2)
        os.replace(temp_name, DATA_FILE)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def backup_legacy_data_file() -> None:
    backup_file = DATA_FILE.with_name(f"{DATA_FILE.name}.legacy.bak")
    if not DATA_FILE.exists() or backup_file.exists():
        return
    try:
        current = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    entries = current.get("entries") if isinstance(current, dict) else None
    has_legacy_entries = isinstance(entries, list) and any(
        isinstance(entry, dict)
        and "hours" in entry
        and "regularHours" not in entry
        and "overtimeHours" not in entry
        for entry in entries
    )
    if has_legacy_entries:
        shutil.copy2(DATA_FILE, backup_file)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def do_GET(self) -> None:
        if self.path == "/api/state" or self.path == "/api/state/":
            self.send_json(read_state())
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/state" and self.path != "/api/state/":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            state = normalize_state(payload)
            write_state(state)
            self.send_json({"ok": True})
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "Invalid JSON")

    def send_json(self, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="業務日報アプリの共有サーバー")
    parser.add_argument("--host", default="127.0.0.1", help="共有する場合は 0.0.0.0 を指定")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Serving on http://{args.host}:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
