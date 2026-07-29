// ─── America/Los_Angeles date helpers (client) ────────────────────────────────
// Business dates are LA-local 'YYYY-MM-DD' strings regardless of the viewing
// browser's timezone. Sell-out times and date bucketing are pinned to LA.

export const LA_TZ = "America/Los_Angeles";
export const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export const STORE_OPEN_H = 7;

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ, hour12: false, hour: "2-digit", minute: "2-digit",
});
const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// LA calendar date for a UTC instant / ISO string
export function laDateStr(dateOrIso = new Date()) {
  return dateFmt.format(typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso);
}

export function laTimeParts(dateOrIso) {
  const p = {};
  const d = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  for (const { type, value } of timeFmt.formatToParts(d)) p[type] = value;
  return { hour: +p.hour % 24, minute: +p.minute };
}

function laOffsetMs(date) {
  const p = {};
  for (const { type, value } of offsetFmt.formatToParts(date)) p[type] = value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// UTC ISO instant for an LA wall-clock time on an LA date — offset computed
// from the actual date, so PST/PDT are both handled (spec §11.1)
export function laToUtcISO(dateStr, hour = 0, minute = 0) {
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const corrected = new Date(guess.getTime() - laOffsetMs(guess));
  return new Date(corrected.getTime() + (laOffsetMs(guess) - laOffsetMs(corrected))).toISOString();
}

// 'YYYY-MM-DD' string arithmetic (calendar days)
export function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

// Monday of the last fully completed week, as an LA date string
export function getLastCompletedMonday() {
  const today = laDateStr();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();  // 0=Sun
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  return addDaysStr(today, -daysSinceMon - 7);
}

export function formatWeekLabel(mondayStr) {
  const fmt = s => {
    const [y, m, d] = s.split("-");
    return `${+m}/${+d}/${y.slice(2)}`;
  };
  return `Week of ${fmt(mondayStr)} – ${fmt(addDaysStr(mondayStr, 6))}`;
}

// Time-of-day in LA for an ISO instant, e.g. "9:41 AM"
export function formatTime(iso) {
  if (!iso) return null;
  let { hour: h, minute: m } = laTimeParts(iso);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function minutesFromOpen(iso) {
  if (!iso) return null;
  const { hour, minute } = laTimeParts(iso);
  return (hour - STORE_OPEN_H) * 60 + minute;
}

export function minsToLabel(m) {
  if (m == null) return "—";
  const h = Math.floor(m / 60), min = m % 60;
  return h > 0 ? `${h}h ${min}m after open` : `${min}m after open`;
}

export function fmtMoney(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
