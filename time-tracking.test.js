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

const { aggregateWeeklyHours } = require("./time-tracking");

const ME = "me-profile";
function task(id, activities) {
  return { id, annotationProjectActivities: activities };
}
function act(createdAt, seconds, profileId = ME) {
  return { createdAt, timeWorkedInSeconds: seconds, profileId };
}

test("aggregateWeeklyHours sums my activities into the right week", () => {
  const tasks = [
    task("t1", [act("2026-05-18T09:00:00Z", 3600), act("2026-05-20T09:00:00Z", 1800)]),
  ];
  const { weeks, totals } = aggregateWeeklyHours(tasks, ME);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].weekStart, "2026-05-18");
  assert.equal(weeks[0].seconds, 5400);
  assert.equal(weeks[0].hours, 1.5);
  assert.equal(weeks[0].taskCount, 1);
  assert.equal(totals.seconds, 5400);
  assert.equal(totals.taskCount, 1);
  assert.equal(totals.weekCount, 1);
});

test("aggregateWeeklyHours splits one task across two weeks and counts it in each", () => {
  const tasks = [
    task("t1", [act("2026-05-18T09:00:00Z", 3600), act("2026-05-25T09:00:00Z", 3600)]),
  ];
  const { weeks, totals } = aggregateWeeklyHours(tasks, ME);
  assert.deepEqual(weeks.map((w) => w.weekStart), ["2026-05-18", "2026-05-25"]);
  assert.equal(weeks[0].taskCount, 1);
  assert.equal(weeks[1].taskCount, 1);
  assert.equal(totals.taskCount, 1); // distinct across weeks
  assert.equal(totals.weekCount, 2);
});

test("aggregateWeeklyHours ignores other people's activities and non-positive time", () => {
  const tasks = [
    task("t1", [act("2026-05-18T09:00:00Z", 3600, "someone-else"), act("2026-05-18T10:00:00Z", 0)]),
  ];
  const { weeks, totals } = aggregateWeeklyHours(tasks, ME);
  assert.equal(weeks.length, 0);
  assert.equal(totals.seconds, 0);
  assert.equal(totals.taskCount, 0);
});

test("aggregateWeeklyHours tolerates missing/empty activity arrays", () => {
  const tasks = [{ id: "t1" }, task("t2", []), task("t3", [act("2026-05-18T09:00:00Z", 7200)])];
  const { weeks } = aggregateWeeklyHours(tasks, ME);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].hours, 2);
});

test("aggregateWeeklyHours returns weeks ascending by weekStart", () => {
  const tasks = [
    task("a", [act("2026-05-25T09:00:00Z", 3600)]),
    task("b", [act("2026-05-04T09:00:00Z", 3600)]),
  ];
  const { weeks } = aggregateWeeklyHours(tasks, ME);
  assert.deepEqual(weeks.map((w) => w.weekStart), ["2026-05-04", "2026-05-25"]);
});
