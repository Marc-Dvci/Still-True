// Wikipedia's Current Events portal (one wikitext page per day) -> NewsItem[] for attacks and disasters.
// An item is located only by its topic title and by "in/near/at [[Place]]" phrases, never by every
// country it mentions: "the United States conducts airstrikes" in an item about Iraq does not make it
// a US event.
import places from "../../data/places.json";
import type { NewsItem } from "./types";

const PLACE_TO_COUNTRY = (places as { places: Record<string, string> }).places;

const ATTACK =
  /\b(shooting|gunman|gunfire|stabbing|bombing|bomb|explosive device|suicide attack|terror(?:ist|ism)? attack|massacre|hostage|ramming|car attack|attack(?:s|ed)?)\b/i;
const DISASTER =
  /\b(earthquake|wildfires?|bushfire|flood(?:s|ing)?|hurricane|typhoon|cyclone|tornado|landslide|avalanche|tsunami|eruption|stampede|collapse[sd]?|crash(?:es|ed)?|derail(?:s|ed|ment)|collision|explosion|fire|plunges?|accident)\b/i;
const HARM =
  /\b(kill(?:s|ed|ing)?|dead|deaths?|die[sd]?|injur(?:es|ed|ing|ies)|wounded|missing|evacuat(?:e|ed|es|ion)|casualties)\b/i;

function linkTarget(raw: string): string {
  const target = raw.split("|")[0] ?? raw;
  return target.split("#")[0]?.trim() ?? target.trim();
}

function linksIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => linkTarget(m[1] ?? ""));
}

function countryOfName(name: string): string | null {
  if (PLACE_TO_COUNTRY[name]) return PLACE_TO_COUNTRY[name] as string;
  // "Pacific Palisades, Los Angeles" -> "Los Angeles"; "Goma, North Kivu" -> "North Kivu"
  for (const part of name
    .split(",")
    .map((s) => s.trim())
    .reverse()) {
    if (PLACE_TO_COUNTRY[part]) return PLACE_TO_COUNTRY[part] as string;
  }
  // "January 2025 Southern California wildfires", "November 2015 Paris attacks"
  for (const [place, code] of Object.entries(PLACE_TO_COUNTRY)) {
    if (
      place.length >= 4 &&
      new RegExp(`(^|\\s)${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(name)
    )
      return code;
  }
  return null;
}

function locate(topic: string | null, body: string): string[] {
  const found = new Set<string>();
  if (topic) {
    const code = countryOfName(topic);
    if (code) found.add(code);
  }
  for (const match of body.matchAll(
    /\b(?:in|near|at|across|outside|off|on)\s+(?:(?:the|northern|southern|eastern|western|central|north|south|east|west)\s+){0,2}((?:\[\[[^\]]+\]\](?:,\s*)?)+)/gi,
  )) {
    for (const target of linksIn(match[1] ?? "")) {
      const code = countryOfName(target);
      if (code) found.add(code);
    }
  }
  return [...found];
}

export function plainText(wikitext: string): string {
  return wikitext
    .replace(/\[https?:\/\/[^\s\]]+(?:\s+([^\]]*))?\]/g, "")
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'''?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits the day's wikitext into top-level items (a "*" line and its deeper "**" lines). */
export function topLevelItems(wikitext: string): { topic: string | null; lines: string[] }[] {
  const items: { topic: string | null; lines: string[] }[] = [];
  for (const line of wikitext.split("\n")) {
    const depth = /^(\*+)/.exec(line)?.[1]?.length ?? 0;
    if (depth === 0) continue;
    const text = line.replace(/^\*+\s*/, "");
    if (depth === 1) {
      const onlyLinks = /^(\[\[[^\]]+\]\](?:,\s*)?)+$/.test(text.trim());
      items.push({ topic: onlyLinks ? (linksIn(text)[0] ?? null) : null, lines: onlyLinks ? [] : [text] });
    } else if (items.length > 0) {
      (items[items.length - 1] as { lines: string[] }).lines.push(text);
    }
  }
  return items;
}

export function parseCurrentEvents(wikitext: string, date: string): NewsItem[] {
  const news: NewsItem[] = [];
  for (const item of topLevelItems(wikitext)) {
    const body = item.lines.join("\n");
    const text = `${item.topic ?? ""} ${plainText(body)}`;
    const attack = ATTACK.test(text);
    const disaster = DISASTER.test(text);
    if (!(attack || disaster) || !HARM.test(text)) continue;
    const countries = locate(item.topic, body);
    if (countries.length === 0) continue;
    const headline = plainText(item.lines.find((l) => HARM.test(l)) ?? item.lines[0] ?? item.topic ?? "");
    news.push({
      date,
      category: attack ? "attacks" : "disasters",
      countries,
      headline: headline.length > 220 ? `${headline.slice(0, 217)}...` : headline,
    });
  }
  return news;
}

/** Portal page title for a date, e.g. "Portal:Current_events/2026_November_10". */
export function currentEventsTitle(dateKey: string): string {
  const months = [
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
  const [year, month, day] = dateKey.split("-").map(Number);
  return `Portal:Current_events/${year}_${months[(month ?? 1) - 1]}_${day}`;
}
