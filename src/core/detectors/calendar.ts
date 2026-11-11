// Calendar: what the post's own words say about time, read on the day it actually goes out.
import { findDates, findRelative, findTimes, findWeekdays, relativeKeys, weekdayName, type DateRef } from "../datetext";
import { findAll, has, matchCase, sentences, type Match } from "../text";
import { formatLocalDate, localParts, weekdayOf } from "../time";
import type { CheckContext, Evidence, Finding, PostUnderCheck } from "../types";

const SAME_DAY = /\b(today|tonight|this evening|aujourd'?hui|ce soir)\b/;
const EVENT_START = /\b(doors open|doors at|starts? at|starting at|begins? at|kicks? off at|ouverture des portes|ca commence|debut a|commence a)\b/;
const FUTURE_CUE =
  /\b(join us|see you|come (?:by|down|along|and)|don'?t miss|until|through|ends?|ending|last day|last chance|book|register|tickets?|on sale|opens?|happening|save the date|venez|rejoignez|rendez-vous|jusqu'?au|jusqu'?a|dernier jour|derniere chance|ne manquez pas|reservez|inscrivez|billets?|a partir du|des le|le rendez-vous)\b/;
const PAST_CUE =
  /\b(was|were|we had|we celebrated|celebrated|thank you|thanks to everyone|last week|last month|took place|a eu lieu|etait|nous avons|merci a|merci pour|la semaine derniere)\b/;
const MORNING = /\b(good morning|morning all|morning everyone|rise and shine|this morning|bon matin|bonne matinee|ce matin)\b/;
const NIGHT = /\b(good ?night|sweet dreams|bonne nuit)\b/;

function publishing(post: PostUnderCheck): Evidence {
  const local = localParts(post.dueAt, post.timezone);
  return {
    label: "Goes out",
    value: `${formatLocalDate(local.date)}, ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")} (${post.timezone})`,
  };
}

function sentenceOf(sentencesList: Match[], start: number): Match | undefined {
  return sentencesList.find((s) => start >= s.start && start < s.end);
}

function replaceSpan(text: string, start: number, end: number, value: string): string {
  return `${text.slice(0, start)}${value}${text.slice(end)}`;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function calendarFindings(post: PostUnderCheck, ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const text = post.text;
  const due = localParts(post.dueAt, post.timezone);
  const dates = findDates(text, due.date, ctx.country);
  const weekdays = findWeekdays(text, dates);
  const relatives = findRelative(text);
  const parts = sentences(text);
  const goesOut = publishing(post);

  // 1. A weekday written next to a date that falls on another day.
  for (const date of dates) {
    if (!date.weekday) continue;
    const actual = weekdayOf(date.key);
    if (actual === date.weekday.value) continue;
    const correct = matchCase(weekdayName(actual, date.weekday.lang), date.weekday.text);
    findings.push({
      detector: "calendar",
      code: "weekday_date_mismatch",
      verdict: "review",
      title: "Weekday and date disagree",
      detail: `"${date.text}": ${formatLocalDate(date.key).replace(/^\S+ /, "")} ${date.key.slice(0, 4)} is a ${weekdayName(actual, "en")}, not a ${weekdayName(date.weekday.value, "en")}.`,
      evidence: [{ label: "Calendar", value: `${date.key} is a ${weekdayName(actual, "en")}` }, goesOut],
      spans: [[date.start, date.end]],
      fix: {
        kind: "replace_text",
        summary: `Change "${date.weekday.text}" to "${correct}"`,
        text: replaceSpan(text, date.weekday.start, date.weekday.end, correct),
      },
    });
  }

  // 2. A relative day ("tomorrow") that, read on the publish day, contradicts a date or weekday in the
  //    same sentence.
  for (const rel of relatives) {
    if (rel.kind !== "day") continue;
    const sentence = sentenceOf(parts, rel.start);
    if (!sentence) continue;
    const keys = relativeKeys(rel, due.date);
    const keyWeekdays = new Set(keys.map(weekdayOf));
    const anchorDates = dates.filter((d) => d.start >= sentence.start && d.start < sentence.end);
    const anchorWeekdays = weekdays.filter((w) => w.start >= sentence.start && w.start < sentence.end);
    const conflictDate = anchorDates.find((d) => !keys.includes(d.key));
    const conflictWeekday = anchorWeekdays.find((w) => !keyWeekdays.has(w.value));
    const anchor = conflictDate ?? conflictWeekday;
    if (!anchor) continue;
    const meaning = keys.map((k) => formatLocalDate(k)).join(" or ");
    const named = conflictDate ? formatLocalDate(conflictDate.key) : weekdayName((conflictWeekday as { value: number }).value, "en");
    // Fix: keep the explicit day, drop the relative word ("Demain, dimanche 15" -> "Dimanche 15").
    let fixed = replaceSpan(text, rel.start, rel.end, "").replace(/^\s*[,;:]\s*/, "").replace(/\s{2,}/g, " ");
    fixed = fixed.replace(/(^|[.!?]\s+)([a-zà-ÿ])/u, (_m, p: string, c: string) => `${p}${c.toUpperCase()}`);
    findings.push({
      detector: "calendar",
      code: "relative_anchor_conflict",
      verdict: "review",
      title: "Relative day and date disagree",
      detail: `Read on ${formatLocalDate(due.date)}, "${rel.text}" means ${meaning}, but the post names ${named}.`,
      evidence: [goesOut, { label: `"${rel.text}" means`, value: meaning }],
      spans: [[rel.start, rel.end], [anchor.start, anchor.end]],
      fix: { kind: "replace_text", summary: `Remove "${rel.text}" and keep ${named}`, text: fixed.trim() },
    });
  }

  // 3. The post moved to another day since Still True first saw it, and it speaks in relative days.
  if (post.firstSeenDueAt) {
    const before = localParts(post.firstSeenDueAt, post.timezone).date;
    const dayWords = relatives.filter((r) => r.kind === "day" || r.kind === "daypart");
    const thisWeekday = findAll(text, /\b(?:this|ce|cette) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/);
    const words = [...dayWords, ...thisWeekday];
    if (before !== due.date && words.length > 0) {
      findings.push({
        detector: "calendar",
        code: "due_moved_relative_word",
        verdict: "review",
        title: "Post moved to another day",
        detail: `It was due ${formatLocalDate(before)} and now goes out ${formatLocalDate(due.date)}. "${words[0]?.text}" now points to a different day.`,
        evidence: [{ label: "First seen due", value: formatLocalDate(before) }, goesOut],
        spans: words.map((w) => [w.start, w.end] as [number, number]),
      });
    }
  }

  // 4. "Tonight at 7pm" going out after 7pm the same day.
  const dueMinutes = due.hour * 60 + due.minute;
  for (const sentence of parts) {
    const sameDay = has(sentence.text, SAME_DAY);
    const starts = has(sentence.text, EVENT_START);
    if (!sameDay && !starts) continue;
    if (!sameDay && (dates.length > 0 || weekdays.length > 0 || relatives.some((r) => r.offset !== 0))) continue;
    const evening = has(sentence.text, /\b(tonight|this evening|ce soir)\b/);
    const times = findTimes(sentence.text, evening).map((t) => ({ ...t, start: t.start + sentence.start, end: t.end + sentence.start }));
    if (times.length === 0) continue;
    const latest = times.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    if (latest.minutes < dueMinutes) {
      findings.push({
        detector: "calendar",
        code: "time_already_passed",
        verdict: "review",
        title: "Time already passed",
        detail: `The post says ${hhmm(latest.minutes)} and goes out at ${hhmm(dueMinutes)} the same day.`,
        evidence: [{ label: "Stated time", value: hhmm(latest.minutes) }, goesOut],
        spans: [[latest.start, latest.end]],
      });
      break;
    }
  }

  // 5. Future or promotional wording about a date that is already behind the publish date.
  for (const date of dates) {
    if (date.key >= due.date) continue;
    const sentence = sentenceOf(parts, date.start);
    if (!sentence || !has(sentence.text, FUTURE_CUE) || has(sentence.text, PAST_CUE)) continue;
    findings.push({
      detector: "calendar",
      code: "date_already_passed",
      verdict: "hold",
      title: "Date already passed",
      detail: `"${date.text}" is before the publish date, ${formatLocalDate(due.date)}.`,
      evidence: [{ label: "Date in the post", value: formatLocalDate(date.key) }, goesOut],
      spans: [[date.start, date.end]],
    });
    break;
  }

  // 6. "Good morning" in the evening, "good night" in the morning.
  const morning = findAll(text, MORNING)[0];
  const night = findAll(text, NIGHT)[0];
  const greeting = morning && due.hour >= 18 ? morning : night && due.hour < 12 ? night : null;
  if (greeting) {
    findings.push({
      detector: "calendar",
      code: "daypart_mismatch",
      verdict: "review",
      title: "Greeting does not fit the hour",
      detail: `"${greeting.text}" goes out at ${hhmm(dueMinutes)} local time.`,
      evidence: [goesOut],
      spans: [[greeting.start, greeting.end]],
    });
  }

  return findings;
}

export type { DateRef };
