const assert = require("node:assert/strict");
const test = require("node:test");
const { weekStartUtc } = require("./time-tracking");

test("weekStartUtc returns the Monday (UTC) for a mid-week timestamp", () => {
  // 2026-05-20 is a Wednesday → week Monday is 2026-05-18
  assert.equal(weekStartUtc("2026-05-20T10:00:00.000Z"), "2026-05-18");
});

test("weekStartUtc treats Monday as the start of its own week", () => {
  assert.equal(weekStartUtc("2026-05-18T00:00:00.000Z"), "2026-05-18");
});

test("weekStartUtc rolls Sunday back to the previous Monday", () => {
  // 2026-05-24 is a Sunday → Monday is 2026-05-18
  assert.equal(weekStartUtc("2026-05-24T23:59:59.000Z"), "2026-05-18");
});

test("weekStartUtc returns null for unparseable input", () => {
  assert.equal(weekStartUtc("not-a-date"), null);
  assert.equal(weekStartUtc(null), null);
});
