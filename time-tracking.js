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

module.exports = { weekStartUtc, aggregateWeeklyHours };
