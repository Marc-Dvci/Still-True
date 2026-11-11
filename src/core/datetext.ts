// Dates, weekdays, relative days and clock times written in a post (English and French).
import { addDays, daysBetween, isRealDate, toDateKey, weekdayOf } from "./time";
import { fold, maskUrls, type Match } from "./text";

const WEEKDAY_WORDS: [string, number, "en" | "fr", boolean][] = [
  ["monday", 1, "en", true],
  ["tuesday", 2, "en", true],
  ["wednesday", 3, "en", true],
  ["thursday", 4, "en", true],
  ["friday", 5, "en", true],
  ["saturday", 6, "en", true],
  ["sunday", 7, "en", true],
  ["mon", 1, "en", false],
  ["tues", 2, "en", false],
  ["tue", 2, "en", false],
  ["wed", 3, "en", false],
  ["thurs", 4, "en", false],
  ["thur", 4, "en", false],
  ["thu", 4, "en", false],
  ["fri", 5, "en", false],
  ["sat", 6, "en", false],
  ["sun", 7, "en", false],
  ["lundi", 1, "fr", true],
  ["mardi", 2, "fr", true],
  ["mercredi", 3, "fr", true],
  ["jeudi", 4, "fr", true],
  ["vendredi", 5, "fr", true],
  ["samedi", 6, "fr", true],
  ["dimanche", 7, "fr", true],
];
const MONTH_WORDS: [string, number][] = [
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
  ["janvier", 1],
  ["fevrier", 2],
  ["mars", 3],
  ["avril", 4],
  ["mai", 5],
  ["juin", 6],
  ["juillet", 7],
  ["aout", 8],
  ["septembre", 9],
  ["octobre", 10],
  ["novembre", 11],
  ["decembre", 12],
  ["sept", 9],
  ["janv", 1],
  ["fevr", 2],
  ["juil", 7],
  ["avr", 4],
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
];

const WEEKDAY_ALT = WEEKDAY_WORDS.map(([w]) => w)
  .sort((a, b) => b.length - a.length)
  .join("|");
const WEEKDAY_FULL_ALT = WEEKDAY_WORDS.filter((w) => w[3])
  .map(([w]) => w)
  .join("|");
const MONTH_ALT = MONTH_WORDS.map(([m]) => m)
  .sort((a, b) => b.length - a.length)
  .join("|");
const MONTH_INDEX = new Map(MONTH_WORDS);
const WEEKDAY_INDEX = new Map(WEEKDAY_WORDS.map(([w, n, lang]) => [w, { n, lang }]));

export interface WeekdayRef extends Match {
  value: number;
  lang: "en" | "fr";
}

export interface DateRef extends Match {
  day: number;
  month: number;
  year: number | null;
  /** Resolved YYYY-MM-DD, the year inferred as the one that puts the date nearest the publish date. */
  key: string;
  weekday: WeekdayRef | null;
  lang: "en" | "fr";
}

/** Infers the year of a day-month that has none: the same year as the publish date unless that puts it
 * more than 60 days before (then next year) or more than 300 days after (then the year before). */
export function resolveYear(day: number, month: number, dueKey: string): number {
  const dueYear = Number(dueKey.slice(0, 4));
  const candidate = toDateKey(dueYear, month, day);
  const delta = daysBetween(dueKey, candidate);
  if (delta < -60) return dueYear + 1;
  if (delta > 300) return dueYear - 1;
  return dueYear;
}

function weekdayAt(original: string, folded: string, start: number, word: string): WeekdayRef | null {
  const info = WEEKDAY_INDEX.get(word);
  if (!info) return null;
  return {
    text: original.slice(start, start + word.length),
    start,
    end: start + word.length,
    value: info.n,
    lang: info.lang,
  };
}

export function findDates(text: string, dueKey: string, country = ""): DateRef[] {
  const folded = fold(maskUrls(text));
  const out: DateRef[] = [];
  const taken: [number, number][] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const add = (
    m: RegExpMatchArray,
    wd: string | undefined,
    day: number,
    month: number,
    yearRaw: string | undefined,
    lang: "en" | "fr",
  ) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) return;
    let year = yearRaw ? Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : null;
    if (year === null) year = resolveYear(day, month, dueKey);
    if (!isRealDate(year, month, day)) return;
    taken.push([start, end]);
    const weekday = wd ? weekdayAt(text, folded, start + m[0].indexOf(wd), wd) : null;
    out.push({
      text: text.slice(start, end),
      start,
      end,
      day,
      month,
      year: yearRaw ? year : null,
      key: toDateKey(year, month, day),
      weekday,
      lang: weekday?.lang ?? lang,
    });
  };

  // "Friday 14 November", "vendredi 1er decembre 2026", "14th of Nov", "Sat. 5 Dec"
  const dayFirst = new RegExp(
    `(?:\\b(${WEEKDAY_ALT})\\.?,?\\s+(?:the\\s+|le\\s+)?)?\\b(\\d{1,2})(?:st|nd|rd|th|er|e|eme)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b\\.?(?:,?\\s+(\\d{4}))?`,
    "g",
  );
  for (const m of folded.matchAll(dayFirst)) {
    const month = MONTH_INDEX.get(m[3] as string) as number;
    const lang =
      /[a-z]/.test(m[3] ?? "") &&
      [
        "janvier",
        "fevrier",
        "mars",
        "avril",
        "mai",
        "juin",
        "juillet",
        "aout",
        "septembre",
        "octobre",
        "novembre",
        "decembre",
        "janv",
        "fevr",
        "juil",
        "avr",
      ].includes(m[3] as string)
        ? "fr"
        : "en";
    add(m, m[1], Number(m[2]), month, m[4], lang);
  }
  // "Friday, November 14", "Nov 14th, 2026"
  const monthFirst = new RegExp(
    `(?:\\b(${WEEKDAY_ALT})\\.?,?\\s+)?\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
    "g",
  );
  for (const m of folded.matchAll(monthFirst)) {
    const month = MONTH_INDEX.get(m[2] as string) as number;
    add(m, m[1], Number(m[3]), month, m[4], "en");
  }
  // "14/11", "11/14/2026" (month first in the US)
  const numeric = new RegExp(
    `(?:\\b(${WEEKDAY_ALT})\\.?,?\\s+)?\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`,
    "g",
  );
  for (const m of folded.matchAll(numeric)) {
    const a = Number(m[2]);
    const b = Number(m[3]);
    const [day, month] = country === "US" ? [b, a] : [a, b];
    if (month < 1 || month > 12) continue;
    add(m, m[1], day, month, m[4], "en");
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Full weekday names that are not part of a date ("this Friday", "on Saturday", "ce samedi"). */
export function findWeekdays(text: string, dates: DateRef[]): WeekdayRef[] {
  const folded = fold(maskUrls(text));
  const out: WeekdayRef[] = [];
  for (const m of folded.matchAll(new RegExp(`\\b(${WEEKDAY_FULL_ALT})s?\\b`, "g"))) {
    const start = m.index ?? 0;
    if (dates.some((d) => start >= d.start && start < d.end)) continue;
    const ref = weekdayAt(text, folded, start, m[1] as string);
    if (ref) out.push(ref);
  }
  return out;
}

export interface RelativeRef extends Match {
  /** Days after the publish date the word points to; "weekend" for this weekend. */
  offset: number | "weekend";
  kind: "day" | "daypart";
}

const RELATIVE: [RegExp, number | "weekend", "day" | "daypart"][] = [
  [/\bthe day after tomorrow\b|\bapres-demain\b|\bapres demain\b/g, 2, "day"],
  [/\btomorrow(?: night| morning| evening| afternoon)?\b|(?<!apres[- ])\bdemain\b/g, 1, "day"],
  [/\btoday\b|\btonight\b|\bthis evening\b|\baujourd'?hui\b|\bce soir\b/g, 0, "day"],
  [/\bthis morning\b|\bthis afternoon\b|\bce matin\b|\bcet apres-midi\b|\bce midi\b/g, 0, "daypart"],
  [/\bthis weekend\b|\bce week-?end\b/g, "weekend", "day"],
];

export function findRelative(text: string): RelativeRef[] {
  const folded = fold(maskUrls(text));
  const out: RelativeRef[] = [];
  for (const [pattern, offset, kind] of RELATIVE) {
    for (const m of folded.matchAll(pattern)) {
      const start = m.index ?? 0;
      if (out.some((r) => start < r.end && start + m[0].length > r.start)) continue;
      out.push({
        text: text.slice(start, start + m[0].length),
        start,
        end: start + m[0].length,
        offset,
        kind,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The date keys a relative word can mean when published on `dueKey`. */
export function relativeKeys(ref: RelativeRef, dueKey: string): string[] {
  if (ref.offset === "weekend") {
    const wd = weekdayOf(dueKey);
    if (wd === 7) return [dueKey];
    if (wd === 6) return [dueKey, addDays(dueKey, 1)];
    return [addDays(dueKey, 6 - wd), addDays(dueKey, 7 - wd)];
  }
  return [addDays(dueKey, ref.offset)];
}

export interface TimeRef extends Match {
  minutes: number;
}

/** Clock times: "7pm", "7:30 pm", "19h", "20h30", "19:30". `evening` turns a bare "7" into 19:00. */
export function findTimes(text: string, evening = false): TimeRef[] {
  const folded = fold(maskUrls(text));
  const out: TimeRef[] = [];
  const push = (start: number, len: number, h: number, m: number) => {
    if (h > 23 || m > 59) return;
    if (out.some((t) => start < t.end && start + len > t.start)) return;
    out.push({ text: text.slice(start, start + len), start, end: start + len, minutes: h * 60 + m });
  };
  for (const m of folded.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)/g)) {
    let h = Number(m[1]) % 12;
    if ((m[3] ?? "").startsWith("p")) h += 12;
    push(m.index ?? 0, m[0].length, h, Number(m[2] ?? 0));
  }
  for (const m of folded.matchAll(/\b(\d{1,2})\s?h\s?(\d{2})?\b/g))
    push(m.index ?? 0, m[0].length, Number(m[1]), Number(m[2] ?? 0));
  for (const m of folded.matchAll(/\b(\d{1,2}):(\d{2})\b/g))
    push(m.index ?? 0, m[0].length, Number(m[1]), Number(m[2]));
  if (evening) {
    for (const m of folded.matchAll(
      /\b(?:at|from|a|des|vers)\s+(\d{1,2})\b(?![:h.\d%]|\s?(?:am|pm|h\b|€|\$|£|euro|%))/g,
    )) {
      const h = Number(m[1]);
      if (h >= 1 && h <= 11)
        push((m.index ?? 0) + m[0].indexOf(m[1] as string), (m[1] as string).length, h + 12, 0);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function weekdayName(n: number, lang: "en" | "fr"): string {
  const en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const fr = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  return (lang === "fr" ? fr : en)[n - 1] as string;
}
