// ─── America/Los_Angeles date helpers ─────────────────────────────────────────
// All business dates in Crumbs are LA-local calendar dates ('YYYY-MM-DD').
// These helpers derive UTC instants from LA wall-clock times and vice versa,
// computing the offset per-date so DST transitions are handled correctly.

export const LA_TZ = "America/Los_Angeles";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// Offset (ms) of LA relative to UTC at the given instant (negative = behind UTC)
export function laOffsetMs(date) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// UTC ISO instant for a given LA wall-clock time on a given LA date
export function laToUtcISO(dateStr, hour = 0, minute = 0) {
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  // One correction pass is sufficient: offsets only change at 2am local
  const corrected = new Date(guess.getTime() - laOffsetMs(guess));
  return new Date(corrected.getTime() + (laOffsetMs(guess) - laOffsetMs(corrected))).toISOString();
}

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

// LA calendar date ('YYYY-MM-DD') for a UTC instant / ISO string
export function laDateStr(dateOrIso = new Date()) {
  return dateFmt.format(typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso);
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ, hour12: false, hour: "2-digit", minute: "2-digit",
});

// { hour, minute } LA wall clock for a UTC instant
export function laTimeParts(dateOrIso) {
  const p = {};
  const d = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  for (const { type, value } of timeFmt.formatToParts(d)) p[type] = value;
  return { hour: +p.hour % 24, minute: +p.minute };
}

// 'YYYY-MM-DD' string arithmetic (calendar days, DST-safe)
export function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

// 0=Sunday..6=Saturday for a 'YYYY-MM-DD'
export function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

export function nowISO() {
  return new Date().toISOString();
}

// Each LA calendar date in [from, to] inclusive
export function dateRange(fromStr, toStr) {
  const out = [];
  for (let d = fromStr; d <= toStr; d = addDaysStr(d, 1)) out.push(d);
  return out;
}
