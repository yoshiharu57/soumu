from __future__ import annotations

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import server


class NormalizeStateTests(unittest.TestCase):
    def test_legacy_hours_are_migrated_to_regular_hours(self) -> None:
        state = server.normalize_state(
            {
                "employees": ["技術者01"],
                "projects": ["道路設計"],
                "entries": [
                    {
                        "id": "old-1",
                        "date": "2026-08-01",
                        "employee": "技術者01",
                        "project": "道路設計",
                        "hours": 7.5,
                    }
                ],
            }
        )

        self.assertEqual(state["entries"][0]["regularHours"], 7.5)
        self.assertEqual(state["entries"][0]["overtimeHours"], 0)
        self.assertEqual(state["entries"][0]["hours"], 7.5)

    def test_split_hours_are_preserved_and_invalid_values_are_safe(self) -> None:
        entries = server.normalize_entries(
            [
                {
                    "date": "2026-08-02",
                    "employee": "技術者02",
                    "project": "橋梁点検",
                    "regularHours": 6,
                    "overtimeHours": 2,
                },
                {
                    "date": "2026-08-03",
                    "employee": "技術者02",
                    "project": "橋梁点検",
                    "regularHours": -1,
                    "overtimeHours": "invalid",
                },
            ]
        )

        self.assertEqual((entries[0]["regularHours"], entries[0]["overtimeHours"]), (6, 2))
        self.assertEqual((entries[1]["regularHours"], entries[1]["overtimeHours"]), (0, 0))

    def test_snake_case_split_fields_are_supported(self) -> None:
        [entry] = server.normalize_entries(
            [
                {
                    "date": "2026-08-04",
                    "employee": "技術者03",
                    "project": "河川測量",
                    "regular_hours": 6,
                    "overtime_hours": 1.25,
                }
            ]
        )

        self.assertEqual(entry["regularHours"], 6)
        self.assertEqual(entry["overtimeHours"], 1.25)

    def test_first_write_keeps_a_backup_of_legacy_data(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            original_data_file = server.DATA_FILE
            server.DATA_FILE = Path(temp_dir) / "data.json"
            legacy_state = {
                "entries": [
                    {
                        "date": "2026-08-05",
                        "employee": "技術者01",
                        "project": "道路設計",
                        "hours": 8,
                    }
                ]
            }
            server.DATA_FILE.write_text(json.dumps(legacy_state, ensure_ascii=False), encoding="utf-8")
            try:
                server.write_state(server.normalize_state(legacy_state))
                backup = server.DATA_FILE.with_name("data.json.legacy.bak")
                self.assertTrue(backup.exists())
                self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), legacy_state)
            finally:
                server.DATA_FILE = original_data_file


class StateApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_data_file = server.DATA_FILE
        server.DATA_FILE = Path(self.temp_dir.name) / "data.json"
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.DATA_FILE = self.original_data_file
        self.temp_dir.cleanup()

    def request(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=2)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, result

    def test_api_round_trip_normalizes_legacy_data(self) -> None:
        payload = {
            "selectedMonth": "2026-08",
            "employees": ["技術者01"],
            "projects": ["道路設計"],
            "entries": [
                {
                    "id": "legacy-api",
                    "date": "2026-08-05",
                    "employee": "技術者01",
                    "project": "道路設計",
                    "hours": 9,
                }
            ],
        }

        post_status, post_result = self.request("POST", "/api/state", payload)
        get_status, state = self.request("GET", "/api/state")

        self.assertEqual(post_status, 200)
        self.assertEqual(post_result, {"ok": True})
        self.assertEqual(get_status, 200)
        self.assertEqual(state["entries"][0]["regularHours"], 9)
        self.assertEqual(state["entries"][0]["overtimeHours"], 0)
        self.assertEqual(state["entries"][0]["hours"], 9)


if __name__ == "__main__":
    unittest.main()
