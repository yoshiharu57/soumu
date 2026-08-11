const STORAGE_KEY = "roumuNippoApp.v1";
const LEGACY_BACKUP_KEY = `${STORAGE_KEY}.legacyBackup`;
const {
  csvRowsToEntries,
  dailyTotalHours,
  entryHours,
  normalizeEntries: normalizeTimeEntries,
  parseCsv: parseCsvRows,
  summarizeEntries
} = window.TimeEntryModel;

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
  entryRegularHours: document.querySelector("#entryRegularHours"),
  entryOvertimeHours: document.querySelector("#entryOvertimeHours"),
  dailyProgress: document.querySelector("#dailyProgress"),
  dailyTotal: document.querySelector("#dailyTotal"),
  dailyProgressBar: document.querySelector("#dailyProgressBar"),
  dailyProgressMessage: document.querySelector("#dailyProgressMessage"),
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
  metricRegularHours: document.querySelector("#metricRegularHours"),
  metricOvertimeHours: document.querySelector("#metricOvertimeHours"),
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
      regularHours: Number(els.entryRegularHours.value),
      overtimeHours: Number(els.entryOvertimeHours.value)
    };
    const totalHours = entry.regularHours + entry.overtimeHours;
    entry.hours = totalHours;

    if (
      !entry.date
      || !entry.employee
      || !entry.project
      || !Number.isFinite(entry.regularHours)
      || !Number.isFinite(entry.overtimeHours)
      || entry.regularHours < 0
      || entry.overtimeHours < 0
      || totalHours <= 0
      || totalHours > 24
    ) {
      showToast("定時・残業は0以上で、合計を0より大きく24時間以内にしてください。");
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
    els.entryRegularHours.value = 1;
    els.entryOvertimeHours.value = 0;
    renderDailyProgress();
    saveState();
    renderAll();
  });

  els.clearEditButton.addEventListener("click", () => {
    editingId = null;
    els.clearEditButton.classList.add("hidden");
    els.entryForm.reset();
    els.entryDate.value = `${state.selectedMonth}-01`;
    els.entryRegularHours.value = 1;
    els.entryOvertimeHours.value = 0;
    renderDailyProgress();
  });

  els.entrySearch.addEventListener("input", renderEntries);
  [els.entryDate, els.entryEmployee, els.entryRegularHours, els.entryOvertimeHours].forEach((control) => {
    control.addEventListener("input", renderDailyProgress);
    control.addEventListener("change", renderDailyProgress);
  });

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
    const parsed = JSON.parse(raw);
    const hasLegacyEntries = Array.isArray(parsed.entries) && parsed.entries.some(
      (entry) => entry && Object.prototype.hasOwnProperty.call(entry, "hours")
        && !Object.prototype.hasOwnProperty.call(entry, "regularHours")
        && !Object.prototype.hasOwnProperty.call(entry, "overtimeHours")
    );
    if (hasLegacyEntries && !localStorage.getItem(LEGACY_BACKUP_KEY)) {
      localStorage.setItem(LEGACY_BACKUP_KEY, raw);
    }
    return normalizeState(parsed);
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
  return normalizeTimeEntries(entries, () => crypto.randomUUID());
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
  renderDailyProgress();
  renderMetrics();
  renderEntries();
  renderSummary();
  renderMasters();
}

function renderDailyProgress() {
  const date = els.entryDate.value;
  const employee = els.entryEmployee.value;
  const total = dailyTotalHours(state.entries, date, employee, editingId || "", {
    regularHours: Number(els.entryRegularHours.value || 0),
    overtimeHours: Number(els.entryOvertimeHours.value || 0)
  });
  const remaining = Math.max(0, 8 - total);

  els.dailyTotal.textContent = `${formatHours(total)}時間`;
  els.dailyProgressBar.style.width = `${Math.min(100, (total / 8) * 100)}%`;
  els.dailyProgress.classList.toggle("warning", total > 8);

  if (!date || !employee) {
    els.dailyProgressMessage.textContent = "日付と技術者を選択すると、その日の入力状況を確認できます。";
  } else if (total > 8) {
    els.dailyProgressMessage.textContent = `8時間を${formatHours(total - 8)}時間超えています。入力内容を確認してください。`;
  } else if (remaining === 0) {
    els.dailyProgressMessage.textContent = "8時間分の入力が完了しています。";
  } else {
    els.dailyProgressMessage.textContent = `8時間まで残り${formatHours(remaining)}時間です（入力中の時間を含む）。`;
  }
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
  const totals = entries.reduce(
    (result, entry) => {
      const hours = entryHours(entry);
      result.regularHours += hours.regularHours;
      result.overtimeHours += hours.overtimeHours;
      result.totalHours += hours.totalHours;
      return result;
    },
    { regularHours: 0, overtimeHours: 0, totalHours: 0 }
  );
  const activeEmployees = new Set(entries.map((entry) => entry.employee)).size;

  els.metricTotalHours.textContent = `${formatHours(totals.totalHours)}h`;
  els.metricRegularHours.textContent = `${formatHours(totals.regularHours)}h`;
  els.metricOvertimeHours.textContent = `${formatHours(totals.overtimeHours)}h`;
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
    els.entriesTable.innerHTML = `<tr><td class="empty" colspan="7">この月の日報はまだありません。</td></tr>`;
    return;
  }

  els.entriesTable.innerHTML = entries
    .map(
      (entry) => `
      <tr>
        <td>${escapeHtml(entry.date)}</td>
        <td>${escapeHtml(entry.employee)}</td>
        <td>${escapeHtml(entry.project || "")}</td>
        <td class="num hours-regular">${formatHours(entryHours(entry).regularHours)}</td>
        <td class="num hours-overtime">${formatHours(entryHours(entry).overtimeHours)}</td>
        <td class="num">${formatHours(entryHours(entry).totalHours)}</td>
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
  els.entryRegularHours.value = entryHours(entry).regularHours;
  els.entryOvertimeHours.value = entryHours(entry).overtimeHours;
  els.clearEditButton.classList.remove("hidden");
  renderDailyProgress();
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
  const summary = summarizeEntries(entries, state.employees, state.projects);
  const employees = summary.employees;
  const visibleProjects = summary.projects.length ? summary.projects : ["業務未入力"];
  const emptyHours = { regularHours: 0, overtimeHours: 0, totalHours: 0 };

  const head = `
    <thead>
      <tr>
        <th rowspan="2">業務</th>
        ${employees.map((employee) => `<th class="num employee-group" colspan="3">${escapeHtml(employee)}</th>`).join("")}
        <th class="num total-col" colspan="3">全技術者 合計</th>
      </tr>
      <tr class="summary-subhead">
        ${employees.map(() => `<th class="num hours-regular">定時</th><th class="num hours-overtime">残業</th><th class="num">計</th>`).join("")}
        <th class="num hours-regular total-col">定時</th>
        <th class="num hours-overtime total-col">残業</th>
        <th class="num total-col">計</th>
      </tr>
    </thead>`;

  const bodyRows = visibleProjects
    .map((project) => {
      const row = summary.matrix.get(project) || new Map();
      const projectTotal = summary.projectTotals.get(project) || emptyHours;
      return `
        <tr>
          <td>${escapeHtml(project)}</td>
          ${employees.map((employee) => {
            const hours = row.get(employee) || emptyHours;
            return `<td class="num hours-regular">${formatHours(hours.regularHours)}</td><td class="num hours-overtime">${formatHours(hours.overtimeHours)}</td><td class="num">${formatHours(hours.totalHours)}</td>`;
          }).join("")}
          <td class="num hours-regular total-col">${formatHours(projectTotal.regularHours)}</td>
          <td class="num hours-overtime total-col">${formatHours(projectTotal.overtimeHours)}</td>
          <td class="num total-col">${formatHours(projectTotal.totalHours)}</td>
        </tr>`;
    })
    .join("");

  const totalRow = `
    <tr class="total-row">
      <td>合計</td>
      ${employees.map((employee) => {
        const hours = summary.employeeTotals.get(employee) || emptyHours;
        return `<td class="num hours-regular">${formatHours(hours.regularHours)}</td><td class="num hours-overtime">${formatHours(hours.overtimeHours)}</td><td class="num">${formatHours(hours.totalHours)}</td>`;
      }).join("")}
      <td class="num hours-regular">${formatHours(summary.grandTotal.regularHours)}</td>
      <td class="num hours-overtime">${formatHours(summary.grandTotal.overtimeHours)}</td>
      <td class="num">${formatHours(summary.grandTotal.totalHours)}</td>
    </tr>`;

  els.summaryTable.innerHTML = `${head}<tbody>${bodyRows}${totalRow}</tbody>`;
  renderRanking(summary.projectTotals);
}

function renderRanking(projectTotals) {
  const rows = Array.from(projectTotals.entries())
    .filter(([, hours]) => hours.totalHours > 0)
    .sort((a, b) => b[1].totalHours - a[1].totalHours);

  if (!rows.length) {
    els.taskRanking.innerHTML = `<p class="empty">集計対象の日報がありません。</p>`;
    return;
  }

  const max = rows[0][1].totalHours || 1;
  els.taskRanking.innerHTML = rows
    .map(
      ([task, hours]) => `
      <div class="rank-item">
        <div class="rank-meta">
          <strong>${escapeHtml(task)}</strong>
          <span>定時 ${formatHours(hours.regularHours)}h / 残業 ${formatHours(hours.overtimeHours)}h / 計 ${formatHours(hours.totalHours)}h</span>
        </div>
        <div class="rank-line" aria-hidden="true"><span style="width: ${(hours.totalHours / max) * 100}%"></span></div>
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
  const rows = [
    ["date", "employee", "work", "regularHours", "overtimeHours", "totalHours"],
    ...entries.map((entry) => {
      const hours = entryHours(entry);
      return [entry.date, entry.employee, entry.project || "", formatHours(hours.regularHours), formatHours(hours.overtimeHours), formatHours(hours.totalHours)];
    })
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadText(`日報_${state.selectedMonth}.csv`, `\ufeff${csv}`);
}

function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsvRows(String(reader.result || ""));
    const imported = csvRowsToEntries(rows, () => crypto.randomUUID())
      .filter((entry) => entryHours(entry).totalHours > 0);

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
