const STORAGE_KEY = "roumuNippoApp.v1";

const defaultEmployees = Array.from({ length: 20 }, (_, index) => `技術者${String(index + 1).padStart(2, "0")}`);
const defaultProjects = [];

let state = null;
let backendMode = false;
let saveTimer = null;
let editingId = null;

const els = {
  monthPicker: document.querySelector("#monthPicker"),
  viewTitle: document.querySelector("#viewTitle"),
  entryForm: document.querySelector("#entryForm"),
  entryDate: document.querySelector("#entryDate"),
  entryEmployee: document.querySelector("#entryEmployee"),
  entryProject: document.querySelector("#entryProject"),
  entryHours: document.querySelector("#entryHours"),
  entriesTable: document.querySelector("#entriesTable"),
  entrySearch: document.querySelector("#entrySearch"),
  clearEditButton: document.querySelector("#clearEditButton"),
  summaryTable: document.querySelector("#summaryTable"),
  taskRanking: document.querySelector("#taskRanking"),
  employeeForm: document.querySelector("#employeeForm"),
  employeeName: document.querySelector("#employeeName"),
  employeeList: document.querySelector("#employeeList"),
  toast: document.querySelector("#toast"),
  metricTotalHours: document.querySelector("#metricTotalHours"),
  metricEntryCount: document.querySelector("#metricEntryCount"),
  metricEmployeeCount: document.querySelector("#metricEmployeeCount"),
  copySummaryButton: document.querySelector("#copySummaryButton"),
  printButton: document.querySelector("#printButton"),
  exportButton: document.querySelector("#exportButton"),
  downloadCsvButton: document.querySelector("#downloadCsvButton"),
  csvImport: document.querySelector("#csvImport"),
  resetSampleButton: document.querySelector("#resetSampleButton"),
  deleteAllButton: document.querySelector("#deleteAllButton"),
  storageHint: document.querySelector("#storageHint"),
  projectForm: document.querySelector("#projectForm"),
  projectName: document.querySelector("#projectName"),
  projectList: document.querySelector("#projectList"),
};

init().catch((error) => {
  console.error(error);
  showToast("アプリの初期化でエラーが発生しました。");
});

async function init() {
  state = await loadState();
  const today = new Date();
  const currentMonth = toMonthValue(today);
  els.monthPicker.value = state.selectedMonth || currentMonth;
  els.entryDate.value = toDateValue(today);
  state.selectedMonth = els.monthPicker.value;
  saveState();
  els.storageHint.textContent = backendMode
    ? "共有サーバーに保存され、同じURLの利用者と集計を共有します。"
    : "入力内容はこのブラウザに保存されます。";

  bindEvents();
  renderAll();
}

function bindEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.monthPicker.addEventListener("change", () => {
    state.selectedMonth = els.monthPicker.value;
    saveState();
    renderAll();
  });

  els.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = {
      id: editingId || crypto.randomUUID(),
      date: els.entryDate.value,
      employee: els.entryEmployee.value,
      project: els.entryProject.value,
      hours: Number(els.entryHours.value)
    };

    if (!entry.date || !entry.employee || !entry.project || !Number.isFinite(entry.hours) || entry.hours <= 0) {
      showToast("日付・技術者・業務・時間を確認してください。");
      return;
    }

    if (editingId) {
      state.entries = state.entries.map((item) => (item.id === editingId ? entry : item));
      showToast("日報を更新しました。");
    } else {
      state.entries.push(entry);
      showToast("日報を登録しました。");
    }

    editingId = null;
    els.clearEditButton.classList.add("hidden");
    els.entryForm.reset();
    els.entryDate.value = entry.date;
    els.entryHours.value = 1;
    saveState();
    renderAll();
  });

  els.clearEditButton.addEventListener("click", () => {
    editingId = null;
    els.clearEditButton.classList.add("hidden");
    els.entryForm.reset();
    els.entryDate.value = `${state.selectedMonth}-01`;
    els.entryHours.value = 1;
  });

  els.entrySearch.addEventListener("input", renderEntries);

  els.employeeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addMasterItem("employees", els.employeeName.value);
    els.employeeName.value = "";
  });

  els.projectForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addMasterItem("projects", els.projectName.value);
    els.projectName.value = "";
  });

  els.copySummaryButton.addEventListener("click", copySummary);
  els.printButton.addEventListener("click", () => window.print());
  els.exportButton.addEventListener("click", downloadCsv);
  els.downloadCsvButton.addEventListener("click", downloadCsv);
  els.csvImport.addEventListener("change", importCsv);
  els.resetSampleButton.addEventListener("click", resetMasters);
  els.deleteAllButton.addEventListener("click", deleteAllEntries);
}

function switchView(viewName) {
  const titles = {
    entry: "日報入力",
    summary: "月次集計",
    master: "マスタ管理",
    data: "データ入出力"
  };

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#${viewName}View`).classList.add("active");
  els.viewTitle.textContent = titles[viewName];
}

async function loadState() {
  const localState = loadLocalState();
  if (location.protocol.startsWith("http")) {
    try {
      const response = await fetch("./api/state", { cache: "no-store" });
      if (response.ok) {
        backendMode = true;
        return normalizeState(await response.json());
      }
    } catch {
      backendMode = false;
    }
  }
  return localState;
}

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return normalizeState({});
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return normalizeState({});
  }
}

function normalizeState(value) {
  const entries = Array.isArray(value.entries) ? normalizeEntries(value.entries) : [];
  const existingProjects = Array.isArray(value.projects) ? value.projects : [];
  const projects = [...new Set([...defaultProjects, ...existingProjects, ...entries.map((entry) => entry.project)])].filter(Boolean);

  return {
    selectedMonth: value.selectedMonth || "",
    employees: Array.isArray(value.employees) && value.employees.length ? value.employees : defaultEmployees,
    projects,
    entries
  };
}

function normalizeEntries(entries) {
  return entries
    .map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      date: entry.date || "",
      employee: entry.employee || "",
      project: entry.project || entry.task || "",
      hours: Number(entry.hours || 0)
    }))
    .filter((entry) => entry.date && entry.employee && entry.project && Number.isFinite(entry.hours));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!backendMode) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncBackendState, 160);
}

async function syncBackendState() {
  try {
    const response = await fetch("./api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    if (!response.ok) throw new Error(`保存に失敗しました: ${response.status}`);
  } catch (error) {
    console.warn(error);
    showToast("共有サーバーへの保存に失敗しました。CSV出力で控えてください。");
  }
}

function renderAll() {
  renderSelects();
  renderMetrics();
  renderEntries();
  renderSummary();
  renderMasters();
}

function renderSelects() {
  renderOptions(els.entryEmployee, state.employees);
  renderOptions(els.entryProject, state.projects, "業務を選択");
}

function renderOptions(select, options, placeholder = "") {
  const selected = select.value;
  const placeholderHtml = placeholder
    ? `<option value="" disabled ${selected ? "" : "selected"}>${escapeHtml(placeholder)}</option>`
    : "";
  select.innerHTML = `${placeholderHtml}${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}`;
  if (options.includes(selected)) {
    select.value = selected;
  }
}

function getMonthEntries() {
  return state.entries
    .filter((entry) => entry.date && entry.date.startsWith(state.selectedMonth))
    .sort((a, b) => `${a.date}${a.employee}`.localeCompare(`${b.date}${b.employee}`, "ja"));
}

function renderMetrics() {
  const entries = getMonthEntries();
  const totalHours = sum(entries.map((entry) => entry.hours));
  const activeEmployees = new Set(entries.map((entry) => entry.employee)).size;

  els.metricTotalHours.textContent = `${formatHours(totalHours)}h`;
  els.metricEntryCount.textContent = `${entries.length}件`;
  els.metricEmployeeCount.textContent = `${activeEmployees}人`;
}

function renderEntries() {
  const query = els.entrySearch.value.trim().toLowerCase();
  const entries = getMonthEntries().filter((entry) => {
    const haystack = [entry.employee, entry.project].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  if (!entries.length) {
    els.entriesTable.innerHTML = `<tr><td class="empty" colspan="5">この月の日報はまだありません。</td></tr>`;
    return;
  }

  els.entriesTable.innerHTML = entries
    .map(
      (entry) => `
      <tr>
        <td>${escapeHtml(entry.date)}</td>
        <td>${escapeHtml(entry.employee)}</td>
        <td>${escapeHtml(entry.project || "")}</td>
        <td class="num">${formatHours(entry.hours)}</td>
        <td class="actions-col">
          <div class="row-actions">
            <button class="mini-button" type="button" title="編集" data-edit="${entry.id}">編集</button>
            <button class="mini-button danger" type="button" title="削除" data-delete="${entry.id}">削除</button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  els.entriesTable.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editEntry(button.dataset.edit));
  });
  els.entriesTable.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteEntry(button.dataset.delete));
  });
}

function editEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  editingId = id;
  els.entryDate.value = entry.date;
  els.entryEmployee.value = entry.employee;
  els.entryProject.value = entry.project || "";
  els.entryHours.value = entry.hours;
  els.clearEditButton.classList.remove("hidden");
  switchView("entry");
  showToast("編集内容をフォームに読み込みました。");
}

function deleteEntry(id) {
  if (!confirm("この日報を削除しますか？")) return;
  state.entries = state.entries.filter((entry) => entry.id !== id);
  saveState();
  renderAll();
  showToast("日報を削除しました。");
}

function renderSummary() {
  const entries = getMonthEntries();
  const employeeTotals = new Map();
  const projectTotals = new Map();
  const matrix = new Map();
  const projects = state.projects.filter((project) => entries.some((entry) => entry.project === project));
  const visibleEmployees = state.employees.filter((employee) => entries.some((entry) => entry.employee === employee));
  const employees = visibleEmployees.length ? visibleEmployees : state.employees;
  const visibleProjects = projects.length ? projects : ["業務未入力"];

  visibleProjects.forEach((project) => {
    matrix.set(project, new Map(employees.map((employee) => [employee, 0])));
  });

  entries.forEach((entry) => {
    if (!matrix.has(entry.project)) {
      matrix.set(entry.project, new Map(employees.map((employee) => [employee, 0])));
    }
    if (!matrix.get(entry.project).has(entry.employee)) {
      matrix.get(entry.project).set(entry.employee, 0);
    }
    matrix.get(entry.project).set(entry.employee, matrix.get(entry.project).get(entry.employee) + Number(entry.hours || 0));
    employeeTotals.set(entry.employee, (employeeTotals.get(entry.employee) || 0) + Number(entry.hours || 0));
    projectTotals.set(entry.project, (projectTotals.get(entry.project) || 0) + Number(entry.hours || 0));
  });

  const head = `
    <thead>
      <tr>
        <th>業務</th>
        ${employees.map((employee) => `<th class="num">${escapeHtml(employee)}</th>`).join("")}
        <th class="num total-col">合計</th>
      </tr>
    </thead>`;

  const bodyRows = visibleProjects
    .map((project) => {
      const row = matrix.get(project) || new Map();
      return `
        <tr>
          <td>${escapeHtml(project)}</td>
          ${employees.map((employee) => `<td class="num">${formatHours(row.get(employee) || 0)}</td>`).join("")}
          <td class="num total-col">${formatHours(projectTotals.get(project) || 0)}</td>
        </tr>`;
    })
    .join("");

  const totalRow = `
    <tr class="total-row">
      <td>合計</td>
      ${employees.map((employee) => `<td class="num">${formatHours(employeeTotals.get(employee) || 0)}</td>`).join("")}
      <td class="num">${formatHours(sum(Array.from(projectTotals.values())))}</td>
    </tr>`;

  els.summaryTable.innerHTML = `${head}<tbody>${bodyRows}${totalRow}</tbody>`;
  renderRanking(projectTotals);
}

function renderRanking(projectTotals) {
  const rows = Array.from(projectTotals.entries())
    .filter(([, hours]) => hours > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!rows.length) {
    els.taskRanking.innerHTML = `<p class="empty">集計対象の日報がありません。</p>`;
    return;
  }

  const max = rows[0][1] || 1;
  els.taskRanking.innerHTML = rows
    .map(
      ([task, hours]) => `
      <div class="rank-item">
        <div class="rank-meta">
          <strong>${escapeHtml(task)}</strong>
          <span>${formatHours(hours)}h</span>
        </div>
        <div class="rank-line" aria-hidden="true"><span style="width: ${(hours / max) * 100}%"></span></div>
      </div>`
    )
    .join("");
}

function renderMasters() {
  renderPills(els.employeeList, state.employees, "employees");
  renderPills(els.projectList, state.projects, "projects");
}

function renderPills(container, items, key) {
  container.innerHTML = items
    .map(
      (item) => `
      <span class="pill">
        ${escapeHtml(item)}
        <button type="button" title="削除" data-key="${key}" data-name="${escapeHtml(item)}">×</button>
      </span>`
    )
    .join("");

  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => removeMasterItem(button.dataset.key, button.dataset.name));
  });
}

function addMasterItem(key, value) {
  const name = value.trim();
  if (!name) return;
  if (state[key].includes(name)) {
    showToast("同じ名称がすでに登録されています。");
    return;
  }
  state[key].push(name);
  saveState();
  renderAll();
  showToast("マスタを追加しました。");
}

function removeMasterItem(key, name) {
  const label = key === "employees" ? "技術者" : "業務";
  const isUsed = state.entries.some((entry) => (key === "employees" ? entry.employee === name : entry.project === name));
  if (isUsed) {
    showToast(`日報で使用中の${label}は削除できません。`);
    return;
  }
  if (!confirm(`${name} を削除しますか？`)) return;
  state[key] = state[key].filter((item) => item !== name);
  saveState();
  renderAll();
}

function copySummary() {
  const rows = Array.from(els.summaryTable.querySelectorAll("tr")).map((row) =>
    Array.from(row.children)
      .map((cell) => cell.textContent.trim())
      .join("\t")
  );
  navigator.clipboard.writeText(rows.join("\n")).then(
    () => showToast("集計表をクリップボードにコピーしました。"),
    () => showToast("コピーできませんでした。ブラウザの権限を確認してください。")
  );
}

function downloadCsv() {
  const entries = getMonthEntries();
  const rows = [["date", "employee", "work", "hours"], ...entries.map(entryToCsvRow)];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadText(`日報_${state.selectedMonth}.csv`, `\ufeff${csv}`);
}

function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result || ""));
    const imported = rows
      .slice(1)
      .map(csvRowToEntry)
      .filter((entry) => entry.date && entry.employee && entry.project && Number.isFinite(entry.hours));

    imported.forEach((entry) => {
      if (!state.employees.includes(entry.employee)) state.employees.push(entry.employee);
      if (!state.projects.includes(entry.project)) state.projects.push(entry.project);
    });

    state.entries.push(...imported);
    saveState();
    renderAll();
    showToast(`${imported.length}件の日報を読み込みました。`);
    els.csvImport.value = "";
  };
  reader.readAsText(file, "utf-8");
}

function resetMasters() {
  if (!confirm("未使用の業務を整理し、技術者マスタを初期値に戻しますか？ 使用中の日報は残ります。")) return;
  state.employees = [...new Set([...defaultEmployees, ...state.entries.map((entry) => entry.employee)])];
  state.projects = [...new Set([...defaultProjects, ...state.entries.map((entry) => entry.project)])].filter(Boolean);
  saveState();
  renderAll();
  showToast("初期マスタに戻しました。");
}

function deleteAllEntries() {
  if (!confirm("登録済みの日報をすべて削除しますか？ この操作は元に戻せません。")) return;
  state.entries = [];
  saveState();
  renderAll();
  showToast("日報をすべて削除しました。");
}

function entryToCsvRow(entry) {
  return [entry.date, entry.employee, entry.project || "", formatHours(entry.hours)];
}

function csvRowToEntry(row) {
  const hasOldColumns = row.length >= 5;
  return {
    id: crypto.randomUUID(),
    date: row[0],
    employee: row[1],
    project: hasOldColumns ? row[3] || row[2] || "" : row[2] || "",
    hours: Number(hasOldColumns ? row[4] : row[3])
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.replace(/^\ufeff/, ""));
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.replace(/^\ufeff/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.replace(/^\ufeff/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function formatHours(value) {
  const number = Number(value || 0);
  const fixed = number.toFixed(2);
  if (fixed.endsWith("00")) return number.toFixed(1);
  return fixed.replace(/0$/, "");
}

function toDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthValue(date) {
  return toDateValue(date).slice(0, 7);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}
