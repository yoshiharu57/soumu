const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

test("all static DOM references exist exactly once", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const referencedIds = [...app.matchAll(/document\.querySelector\("#([^"]+)"\)/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate IDs");
  referencedIds.forEach((id) => {
    assert.equal(ids.filter((candidate) => candidate === id).length, 1, `#${id} must exist exactly once`);
  });
});

test("time fields use quarter-hour steps and load model logic before the app", () => {
  assert.match(html, /id="entryRegularHours"[^>]+step="0\.25"/);
  assert.match(html, /id="entryOvertimeHours"[^>]+step="0\.25"/);
  assert.ok(html.indexOf("./logic.js") < html.indexOf("./app.js"));
});
