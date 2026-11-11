// Local calendar arithmetic in a channel's timezone, on Intl (full ICU in Node and in workerd).

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** YYYY-MM-DD in the given timezone. */
  date: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: string | number | Date, timeZone: string): LocalParts {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) parts[part.type] = part.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday ?? ""] ?? 0,
    date: toDateKey(year, month, day),
  };
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

/** Whether year-month-day is a real calendar date (rejects 31 November). */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function weekdayOf(key: string): number {
  const { year, month, day } = parseDateKey(key);
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/** The UTC instant of a local wall-clock time in `timeZone` (resolves DST by re-checking the offset). */
export function localToInstant(dateKey: string, hour: number, minute: number, timeZone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i += 1) {
    const local = localParts(guess, timeZone);
    const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    if (asUtc === target) break;
    guess += target - asUtc;
  }
  return new Date(guess);
}

export const WEEKDAY_NAMES_EN = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const WEEKDAY_NAMES_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatLocalDate(key: string, language: "en" | "fr" = "en"): string {
  const { day, month } = parseDateKey(key);
  const weekday = weekdayOf(key);
  if (language === "fr") {
    const months = [
      "janvier",
      "février",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "août",
      "septembre",
      "octobre",
      "novembre",
      "décembre",
    ];
    return `${WEEKDAY_NAMES_FR[weekday - 1]} ${day} ${months[month - 1]}`;
  }
  return `${WEEKDAY_NAMES_EN[weekday - 1]} ${day} ${MONTH_NAMES_EN[month - 1]}`;
}
