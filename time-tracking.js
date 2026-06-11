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

module.exports = { weekStartUtc };
