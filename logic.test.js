const test = require("node:test");
const assert = require("node:assert/strict");

const {
  csvRowsToEntries,
  dailyTotalHours,
  normalizeEntries,
  parseCsv,
  summarizeEntries
} = require("./logic.js");

test("legacy hours are migrated to regular hours without changing the total", () => {
  const [entry] = normalizeEntries([
    { id: "old-1", date: "2026-08-01", employee: "技術者01", project: "道路設計", hours: 7.5 }
  ]);

  assert.deepEqual(entry, {
    id: "old-1",
    date: "2026-08-01",
    employee: "技術者01",
    project: "道路設計",
    regularHours: 7.5,
    overtimeHours: 0,
    hours: 7.5
  });
});

test("monthly summary keeps regular and overtime totals separate", () => {
  const entries = normalizeEntries([
    { date: "2026-08-01", employee: "技術者01", project: "道路設計", regularHours: 6, overtimeHours: 1.5 },
    { date: "2026-08-02", employee: "技術者01", project: "道路設計", regularHours: 2, overtimeHours: 0.5 },
    { date: "2026-08-02", employee: "技術者02", project: "橋梁点検", regularHours: 7, overtimeHours: 2 }
  ], () => "generated");
  const summary = summarizeEntries(entries, ["技術者01", "技術者02"], ["道路設計", "橋梁点検"]);

  assert.deepEqual(summary.matrix.get("道路設計").get("技術者01"), {
    regularHours: 8,
    overtimeHours: 2,
    totalHours: 10
  });
  assert.deepEqual(summary.employeeTotals.get("技術者02"), {
    regularHours: 7,
    overtimeHours: 2,
    totalHours: 9
  });
  assert.deepEqual(summary.grandTotal, {
    regularHours: 15,
    overtimeHours: 4,
    totalHours: 19
  });
});

test("new CSV imports split fields", () => {
  const rows = parseCsv("date,employee,work,regularHours,overtimeHours,totalHours\r\n2026-08-03,技術者01,河川測量,6.5,1.5,8\r\n");
  const [entry] = csvRowsToEntries(rows, () => "csv-new");

  assert.equal(entry.regularHours, 6.5);
  assert.equal(entry.overtimeHours, 1.5);
});

test("legacy four-column CSV imports hours as regular hours", () => {
  const rows = parseCsv("date,employee,work,hours\n2026-08-04,技術者02,\"橋梁,点検\",8.5\n");
  const [entry] = csvRowsToEntries(rows, () => "csv-old");

  assert.equal(entry.project, "橋梁,点検");
  assert.equal(entry.regularHours, 8.5);
  assert.equal(entry.overtimeHours, 0);
});

test("legacy five-column CSV prefers the project column over the old task column", () => {
  const rows = parseCsv("date,employee,task,project,hours\n2026-08-04,技術者02,旧業務名,橋梁点検,7.5\n");
  const [entry] = csvRowsToEntries(rows, () => "csv-old-five");

  assert.equal(entry.project, "橋梁点検");
  assert.equal(entry.regularHours, 7.5);
  assert.equal(entry.overtimeHours, 0);
});

test("daily threshold rounds floating-point accumulation before warning decisions", () => {
  const entries = [
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `a-${index}`,
      date: "2026-08-06",
      employee: "技術者01",
      project: "道路設計",
      regularHours: 0.1,
      overtimeHours: 0
    })),
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `b-${index}`,
      date: "2026-08-06",
      employee: "技術者01",
      project: "道路設計",
      regularHours: 0.2,
      overtimeHours: 0
    }))
  ];

  assert.equal(dailyTotalHours(entries, "2026-08-06", "技術者01"), 8);
});

test("snake_case split fields from existing integrations remain compatible", () => {
  const [entry] = normalizeEntries([
    { date: "2026-08-07", employee: "技術者03", project: "河川測量", regular_hours: 6, overtime_hours: 1.25 }
  ], () => "snake-case");

  assert.equal(entry.regularHours, 6);
  assert.equal(entry.overtimeHours, 1.25);
});
