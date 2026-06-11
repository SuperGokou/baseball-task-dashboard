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

const { aggregateDailyHours, summarizeTasks, dayUtc } = require("./time-tracking");

test("dayUtc returns the calendar day (UTC)", () => {
  assert.equal(dayUtc("2026-05-20T23:30:00.000Z"), "2026-05-20");
  assert.equal(dayUtc("bad"), null);
});

test("aggregateDailyHours buckets my time by day, ascending", () => {
  const tasks = [
    task("t1", [act("2026-05-18T09:00:00Z", 3600), act("2026-05-19T09:00:00Z", 1800)]),
    task("t2", [act("2026-05-18T22:00:00Z", 1800, "someone-else"), act("2026-05-18T23:00:00Z", 900)]),
  ];
  const { days, totals } = aggregateDailyHours(tasks, ME);
  assert.deepEqual(days.map((d) => d.day), ["2026-05-18", "2026-05-19"]);
  assert.equal(days[0].seconds, 4500); // 3600 + 900 (other person excluded)
  assert.equal(days[0].taskCount, 2);
  assert.equal(days[1].hours, 0.5);
  assert.equal(totals.seconds, 6300);
  assert.equal(totals.dayCount, 2);
});

test("summarizeTasks returns one row per worked task, newest first, summing my time", () => {
  const tasks = [
    { id: "t1", data: { task_title: "Fix bug" }, $related: { pipelineStage: { name: "Delivered" } },
      annotationProjectActivities: [
        { profileId: ME, timeWorkedInSeconds: 600, createdAt: "2026-05-18T09:00:00Z" },
        { profileId: ME, timeWorkedInSeconds: 1200, createdAt: "2026-05-19T09:00:00Z" },
        { profileId: "other", timeWorkedInSeconds: 9999, createdAt: "2026-05-19T09:00:00Z" },
      ] },
    { id: "t2", data: { pr_title: "Add feature" },
      annotationProjectActivities: [{ profileId: ME, timeWorkedInSeconds: 300, createdAt: "2026-05-25T09:00:00Z" }] },
    { id: "t3", annotationProjectActivities: [{ profileId: "other", timeWorkedInSeconds: 500, createdAt: "2026-05-20T09:00:00Z" }] },
  ];
  const rows = summarizeTasks(tasks, ME);
  assert.equal(rows.length, 2); // t3 excluded (none of my time)
  assert.equal(rows[0].id, "t2"); // May 25 newest
  assert.equal(rows[1].id, "t1");
  assert.equal(rows[1].seconds, 1800); // 600 + 1200, excludes other's 9999
  assert.equal(rows[1].title, "Fix bug");
  assert.equal(rows[1].stage, "Delivered");
  assert.equal(rows[1].date.slice(0, 10), "2026-05-19");
});

test("summarizeTasks derives title from problem_statement/instance_id for SWE-bench tasks", () => {
  const tasks = [
    { id: "x1", data: { instance_id: "swebench-modin__modin-6174", problem_statement: "BUG: KeyError for TimeGrouper\n\nmore detail here" },
      annotationProjectActivities: [{ profileId: ME, timeWorkedInSeconds: 600, createdAt: "2026-06-09T09:00:00Z" }] },
  ];
  const rows = summarizeTasks(tasks, ME);
  assert.equal(rows[0].title, "BUG: KeyError for TimeGrouper");
  assert.equal(rows[0].taskKey, "swebench-modin__modin-6174");
});

test("summarizeTasks exposes platform totalTimeSpentInSeconds, falling back to my time", () => {
  const tasks = [
    { id: "a", totalTimeSpentInSeconds: 327, annotationProjectActivities: [
      { profileId: ME, timeWorkedInSeconds: 900, createdAt: "2026-06-09T09:00:00Z" }] },
    { id: "b", annotationProjectActivities: [
      { profileId: ME, timeWorkedInSeconds: 1800, createdAt: "2026-06-08T09:00:00Z" }] },
  ];
  const rows = summarizeTasks(tasks, ME);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.a.totalSeconds, 327); // platform value, not my 900
  assert.equal(byId.b.totalSeconds, 1800); // fallback to my time when platform value absent
});

const { mergeCurrentWeekPayActivities } = require("./time-tracking");

test("mergeCurrentWeekPayActivities overrides current-week days and supplements missing tasks", () => {
  const days = [
    { day: "2026-06-01", dayLabel: "Jun 1", seconds: 3600, hours: 1, taskCount: 1 },
    { day: "2026-06-08", dayLabel: "Jun 8", seconds: 7200, hours: 2, taskCount: 2 }, // will be overridden
  ];
  const claimedIds = ["claimed1"]; // one task already known
  const pay = [
    { taskId: "claimed1", payableHours: 0.5, createdAt: "2026-06-08T09:00:00Z" }, // 1800s
    { taskId: "missing1", payableHours: 0.25, createdAt: "2026-06-08T10:00:00Z" }, // 900s
    { taskId: "missing1", payableHours: 0.25, createdAt: "2026-06-08T11:00:00Z" }, // +900s same task
  ];
  const { days: merged, payTasks } = mergeCurrentWeekPayActivities(days, claimedIds, pay);
  // Jun 1 untouched; Jun 8 replaced by pay sum (1800 + 900 + 900 = 3600), 2 distinct tasks
  const jun8 = merged.find((d) => d.day === "2026-06-08");
  assert.equal(jun8.seconds, 3600);
  assert.equal(jun8.taskCount, 2);
  assert.equal(merged.find((d) => d.day === "2026-06-01").seconds, 3600);
  // only the task NOT in claimed list is supplemented, with its summed pay seconds
  assert.equal(payTasks.length, 1);
  assert.equal(payTasks[0].id, "missing1");
  assert.equal(payTasks[0].totalSeconds, 1800);
});

const { dayPT, weekStartPT } = require("./time-tracking");

test("dayPT/weekStartPT bucket by Pacific Time (handles UTC-midnight rollover)", () => {
  // 2026-06-09T03:00:00Z = 2026-06-08 20:00 PDT -> PT day Jun 8
  assert.equal(dayPT("2026-06-09T03:00:00Z"), "2026-06-08");
  assert.equal(dayPT("2026-06-09T16:00:00Z"), "2026-06-09");
  assert.equal(dayPT("bad"), null);
  // Jun 8 2026 is a Monday -> week start Jun 8
  assert.equal(weekStartPT("2026-06-09T03:00:00Z"), "2026-06-08");
});
