(function exposeTimeEntryModel(root, factory) {
  const model = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (root) root.TimeEntryModel = model;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function toNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function entryHours(entry) {
    const hasSplitHours = Object.prototype.hasOwnProperty.call(entry || {}, "regularHours")
      || Object.prototype.hasOwnProperty.call(entry || {}, "overtimeHours")
      || Object.prototype.hasOwnProperty.call(entry || {}, "regular_hours")
      || Object.prototype.hasOwnProperty.call(entry || {}, "overtime_hours");
    const regularHours = hasSplitHours
      ? toNonNegativeNumber(entry?.regularHours ?? entry?.regular_hours)
      : toNonNegativeNumber(entry?.hours);
    const overtimeHours = hasSplitHours ? toNonNegativeNumber(entry?.overtimeHours ?? entry?.overtime_hours) : 0;
    return { regularHours, overtimeHours, totalHours: regularHours + overtimeHours };
  }

  function roundHours(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function dailyTotalHours(entries, date, employee, excludedId = "", draftEntry = null) {
    const savedTotal = entries
      .filter((entry) => entry.date === date && entry.employee === employee && entry.id !== excludedId)
      .reduce((total, entry) => total + entryHours(entry).totalHours, 0);
    const draftTotal = draftEntry ? entryHours(draftEntry).totalHours : 0;
    return roundHours(savedTotal + draftTotal);
  }

  function normalizeEntry(entry, idFactory = () => "") {
    if (!entry || typeof entry !== "object") return null;
    const hours = entryHours(entry);
    const normalized = {
      id: typeof entry.id === "string" && entry.id ? entry.id : idFactory(),
      date: typeof entry.date === "string" ? entry.date : "",
      employee: typeof entry.employee === "string" ? entry.employee : "",
      project: String(entry.project || entry.task || ""),
      regularHours: hours.regularHours,
      overtimeHours: hours.overtimeHours,
      hours: hours.totalHours
    };
    return normalized.date && normalized.employee && normalized.project ? normalized : null;
  }

  function normalizeEntries(entries, idFactory = () => "") {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => normalizeEntry(entry, idFactory)).filter(Boolean);
  }

  function addHours(target, entry) {
    const hours = entryHours(entry);
    target.regularHours += hours.regularHours;
    target.overtimeHours += hours.overtimeHours;
    target.totalHours += hours.totalHours;
  }

  function emptyHours() {
    return { regularHours: 0, overtimeHours: 0, totalHours: 0 };
  }

  function summarizeEntries(entries, configuredEmployees = [], configuredProjects = []) {
    const employeeTotals = new Map();
    const projectTotals = new Map();
    const matrix = new Map();
    const employeesWithEntries = [...new Set(entries.map((entry) => entry.employee))];
    const projectsWithEntries = [...new Set(entries.map((entry) => entry.project))];
    const employees = configuredEmployees.filter((employee) => employeesWithEntries.includes(employee));
    employeesWithEntries.forEach((employee) => {
      if (!employees.includes(employee)) employees.push(employee);
    });
    if (!employees.length) employees.push(...configuredEmployees);

    const projects = configuredProjects.filter((project) => projectsWithEntries.includes(project));
    projectsWithEntries.forEach((project) => {
      if (!projects.includes(project)) projects.push(project);
    });

    entries.forEach((entry) => {
      if (!employeeTotals.has(entry.employee)) employeeTotals.set(entry.employee, emptyHours());
      if (!projectTotals.has(entry.project)) projectTotals.set(entry.project, emptyHours());
      if (!matrix.has(entry.project)) matrix.set(entry.project, new Map());
      if (!matrix.get(entry.project).has(entry.employee)) matrix.get(entry.project).set(entry.employee, emptyHours());
      addHours(employeeTotals.get(entry.employee), entry);
      addHours(projectTotals.get(entry.project), entry);
      addHours(matrix.get(entry.project).get(entry.employee), entry);
    });

    const grandTotal = emptyHours();
    projectTotals.forEach((hours) => addHours(grandTotal, hours));
    return { employees, projects, employeeTotals, projectTotals, matrix, grandTotal };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell.replace(/^\ufeff/, ""));
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index += 1;
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

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[ _-]/g, "");
  }

  function csvRowsToEntries(rows, idFactory = () => "") {
    if (!Array.isArray(rows) || !rows.length) return [];
    const headers = rows[0].map(normalizeHeader);
    const knownHeaders = new Set([
      "date", "employee", "work", "project", "task", "hours", "regularhours", "overtimehours", "totalhours",
      "日付", "技術者", "業務", "定時", "残業", "合計"
    ]);
    const hasHeader = headers.some((header) => knownHeaders.has(header));
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const indexOf = (...names) => {
      for (const name of names) {
        const index = headers.indexOf(name);
        if (index >= 0) return index;
      }
      return -1;
    };
    const dateIndex = indexOf("date", "日付");
    const employeeIndex = indexOf("employee", "技術者");
    const projectIndex = indexOf("project", "work", "業務", "task");
    const regularIndex = indexOf("regularhours", "定時");
    const overtimeIndex = indexOf("overtimehours", "残業");
    const legacyHoursIndex = indexOf("hours", "totalhours", "合計");

    return dataRows
      .map((row) => {
        const useNamedColumns = hasHeader && dateIndex >= 0 && employeeIndex >= 0 && projectIndex >= 0;
        const hasSplitColumns = regularIndex >= 0 || overtimeIndex >= 0;
        const entry = useNamedColumns
          ? {
              id: idFactory(),
              date: row[dateIndex] || "",
              employee: row[employeeIndex] || "",
              project: row[projectIndex] || "",
              regularHours: hasSplitColumns ? row[regularIndex] : row[legacyHoursIndex],
              overtimeHours: hasSplitColumns ? row[overtimeIndex] : 0
            }
          : {
              id: idFactory(),
              date: row[0] || "",
              employee: row[1] || "",
              project: row.length >= 5 ? row[3] || row[2] || "" : row[2] || "",
              regularHours: row.length >= 5 ? row[4] : row[3],
              overtimeHours: 0
            };
        return normalizeEntry(entry, idFactory);
      })
      .filter(Boolean);
  }

  return {
    csvRowsToEntries,
    dailyTotalHours,
    entryHours,
    normalizeEntries,
    parseCsv,
    summarizeEntries
  };
});
