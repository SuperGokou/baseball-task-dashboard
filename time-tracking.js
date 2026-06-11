/**
 * ISO-week Monday (UTC) for a timestamp, as "YYYY-MM-DD".
 * @param {string|number|Date} value
 * @returns {string|null}
 */
function weekStartUtc(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dayOfWeek)
  );
  return monday.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-05-18" -> "May 18" */
function weekLabel(weekStart) {
  const [y, m, d] = weekStart.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Bucket a fellow's own per-activity worked time into ISO weeks.
 * @param {Array<object>} tasks raw task objects
 * @param {string} profileId the fellow's profile id
 * @returns {{ weeks: Array<object>, totals: object }}
 */
function aggregateWeeklyHours(tasks, profileId) {
  const byWeek = new Map(); // weekStart -> { seconds, taskIds:Set }
  const allTaskIds = new Set();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const activities = Array.isArray(task?.annotationProjectActivities)
      ? task.annotationProjectActivities
      : [];
    for (const activity of activities) {
      if (activity?.profileId !== profileId) continue;
      const seconds = activity?.timeWorkedInSeconds;
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const week = weekStartUtc(activity.createdAt);
      if (!week) continue;

      let bucket = byWeek.get(week);
      if (!bucket) {
        bucket = { seconds: 0, taskIds: new Set() };
        byWeek.set(week, bucket);
      }
      bucket.seconds += seconds;
      if (task?.id != null) {
        bucket.taskIds.add(task.id);
        allTaskIds.add(task.id);
      }
    }
  }

  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStart, bucket]) => ({
      weekStart,
      weekLabel: weekLabel(weekStart),
      seconds: bucket.seconds,
      hours: round2(bucket.seconds / 3600),
      taskCount: bucket.taskIds.size,
    }));

  const totalSeconds = weeks.reduce((sum, w) => sum + w.seconds, 0);
  return {
    weeks,
    totals: {
      seconds: totalSeconds,
      hours: round2(totalSeconds / 3600),
      taskCount: allTaskIds.size,
      weekCount: weeks.length,
    },
  };
}

/** Calendar day (UTC) for a timestamp, as "YYYY-MM-DD". */
function dayUtc(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** "2026-05-18" -> "May 18" (reuses weekLabel formatting). */
function dayLabel(day) {
  return weekLabel(day);
}

/** A fellow's own positive-time activities on a task. */
function myActivities(task, profileId) {
  const activities = Array.isArray(task?.annotationProjectActivities)
    ? task.annotationProjectActivities
    : [];
  return activities.filter(
    (a) =>
      a?.profileId === profileId &&
      Number.isFinite(a?.timeWorkedInSeconds) &&
      a.timeWorkedInSeconds > 0
  );
}

/**
 * Bucket a fellow's own per-activity worked time into calendar days (UTC).
 * @returns {{ days: Array<object>, totals: object }}
 */
function aggregateDailyHours(tasks, profileId) {
  const byDay = new Map(); // day -> { seconds, taskIds:Set }
  const allTaskIds = new Set();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    for (const activity of myActivities(task, profileId)) {
      const day = dayUtc(activity.createdAt);
      if (!day) continue;
      let bucket = byDay.get(day);
      if (!bucket) {
        bucket = { seconds: 0, taskIds: new Set() };
        byDay.set(day, bucket);
      }
      bucket.seconds += activity.timeWorkedInSeconds;
      if (task?.id != null) {
        bucket.taskIds.add(task.id);
        allTaskIds.add(task.id);
      }
    }
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, bucket]) => ({
      day,
      dayLabel: dayLabel(day),
      seconds: bucket.seconds,
      hours: round2(bucket.seconds / 3600),
      taskCount: bucket.taskIds.size,
    }));

  const totalSeconds = days.reduce((sum, d) => sum + d.seconds, 0);
  return {
    days,
    totals: {
      seconds: totalSeconds,
      hours: round2(totalSeconds / 3600),
      taskCount: allTaskIds.size,
      dayCount: days.length,
    },
  };
}

/** Short, stable identifier for a task across the platform's varied data shapes. */
function taskKeyOf(task) {
  const data = task?.data || {};
  return data.task_id || data.instance_id || "";
}

/** Human-readable title across the platform's varied task data shapes. */
function taskTitle(task) {
  const data = task?.data || {};
  const firstLine = String(data.problem_statement || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const title =
    data.task_title ||
    data.pr_title ||
    firstLine ||
    taskKeyOf(task) ||
    task?.title ||
    task?.id ||
    "";
  return title.length > 120 ? title.slice(0, 117) + "…" : title;
}

/**
 * One row per task the fellow actually worked on, newest first.
 * @returns {Array<{id,title,taskKey,stage,seconds,hours,date}>}
 */
function summarizeTasks(tasks, profileId) {
  const rows = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const acts = myActivities(task, profileId);
    if (!acts.length) continue;
    const seconds = acts.reduce((sum, a) => sum + a.timeWorkedInSeconds, 0);
    const days = acts.map((a) => a.createdAt).filter(Boolean).sort();
    const totalSeconds = Number.isFinite(task?.totalTimeSpentInSeconds)
      ? task.totalTimeSpentInSeconds
      : seconds;
    rows.push({
      id: task.id,
      title: taskTitle(task),
      taskKey: taskKeyOf(task),
      stage:
        task?.$related?.pipelineStage?.name || task?.pipelineStage?.name || "",
      seconds,
      totalSeconds,
      hours: round2(seconds / 3600),
      date: days.length ? days[days.length - 1] : null,
    });
  }
  rows.sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da !== db) return da < db ? 1 : -1; // newest first
    return b.seconds - a.seconds;
  });
  return rows;
}

module.exports = {
  weekStartUtc,
  aggregateWeeklyHours,
  dayUtc,
  aggregateDailyHours,
  summarizeTasks,
};
