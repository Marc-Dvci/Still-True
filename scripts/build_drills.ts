// Builds data/drills.json: the fire-drill scenarios, each a real day with the GDACS alerts, Wikipedia
// Current Events and Open-Meteo archive weather recorded for it (sources in test/fixtures).
// Run: npx tsx scripts/build_drills.ts
import { readFileSync, writeFileSync } from "node:fs";
import { parseGdacs } from "../src/core/gdacs";
import type { OpenMeteoHourly } from "../src/core/openmeteo";
import { parseCurrentEvents } from "../src/core/wikinews";

interface ScenarioSource {
  id: string;
  title: string;
  date: string;
  place: string;
  country: string;
  timezone: string;
  lang: "en" | "fr";
  latitude: number;
  longitude: number;
  summary: string;
  gdacs?: string;
  news?: string[];
  weather?: string;
}

const SCENARIOS: ScenarioSource[] = [
  {
    id: "los-angeles-2025-01-08",
    title: "Los Angeles wildfires",
    date: "2025-01-08",
    place: "Los Angeles",
    country: "US",
    timezone: "America/Los_Angeles",
    lang: "en",
    latitude: 34.05,
    longitude: -118.24,
    summary:
      "The Palisades and Eaton fires spread across Los Angeles County. GDACS raised orange wildfire alerts for the United States on 7 and 8 January.",
    gdacs: "la-wildfires-2025-01.json",
    news: ["2025_January_8"],
    weather: "archive-los-angeles-2025-01-08.json",
  },
  {
    id: "valencia-2024-10-29",
    title: "Valencia floods",
    date: "2024-10-29",
    place: "Valencia",
    country: "ES",
    timezone: "Europe/Madrid",
    lang: "en",
    latitude: 39.47,
    longitude: -0.38,
    summary:
      "Torrential rain flooded the Valencia region on 29 October. GDACS raised an orange flood alert for Spain from 27 October.",
    gdacs: "spain-flood-2024-10.json",
    news: ["2024_October_29", "2024_October_30"],
    weather: "archive-valencia-2024-10-29.json",
  },
  {
    id: "turkiye-2023-02-06",
    title: "Türkiye earthquake",
    date: "2023-02-06",
    place: "Istanbul",
    country: "TR",
    timezone: "Europe/Istanbul",
    lang: "en",
    latitude: 41.01,
    longitude: 28.98,
    summary:
      "A magnitude 7.8 earthquake struck southern Türkiye before dawn on 6 February. GDACS raised a red earthquake alert.",
    gdacs: "turkey-eq-2023-02.json",
    news: ["2023_February_6"],
    weather: "archive-istanbul-2023-02-06.json",
  },
  {
    id: "strasbourg-2025-06-15",
    title: "Storm over Strasbourg",
    date: "2025-06-15",
    place: "Strasbourg",
    country: "FR",
    timezone: "Europe/Paris",
    lang: "fr",
    latitude: 48.58,
    longitude: 7.75,
    summary: "After two days of heat, rain and storms reached Strasbourg on Sunday 15 June from mid-morning.",
    weather: "archive-strasbourg-2025-06-14.json",
  },
  {
    id: "paris-2026-11-13",
    title: "Friday 13 November in Paris",
    date: "2026-11-13",
    place: "Paris",
    country: "FR",
    timezone: "Europe/Paris",
    lang: "fr",
    latitude: 48.86,
    longitude: 2.35,
    summary:
      "France remembers the victims of the 13 November 2015 attacks. In 2026 the anniversary falls on a Friday the 13th.",
  },
];

const fixture = (path: string) =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${path}`, import.meta.url), "utf8")) as unknown;

const out = SCENARIOS.map((s) => {
  const gdacs = s.gdacs ? parseGdacs(fixture(`gdacs/${s.gdacs}`)) : [];
  const news = (s.news ?? []).flatMap((day) => {
    const wikitext = (fixture(`wikipedia/${day}.json`) as { parse: { wikitext: string } }).parse.wikitext;
    const months: Record<string, string> = {
      January: "01",
      February: "02",
      March: "03",
      April: "04",
      May: "05",
      June: "06",
      July: "07",
      August: "08",
      September: "09",
      October: "10",
      November: "11",
      December: "12",
    };
    const [y, m, d] = day.split("_");
    return parseCurrentEvents(wikitext, `${y}-${months[m as string]}-${String(d).padStart(2, "0")}`);
  });
  const weather = s.weather ? (fixture(`openmeteo/${s.weather}`) as OpenMeteoHourly) : null;
  return {
    ...s,
    gdacs,
    news,
    weather: weather ? { utc_offset_seconds: weather.utc_offset_seconds ?? 0, hourly: weather.hourly } : null,
    sources: {
      gdacs: s.gdacs ? "GDACS event list (gdacs.org)" : null,
      news: s.news ? "Wikipedia Current Events portal (CC BY-SA 4.0)" : null,
      weather: s.weather ? "Open-Meteo historical weather archive (CC BY 4.0)" : null,
    },
  };
});

writeFileSync(new URL("../data/drills.json", import.meta.url), `${JSON.stringify({ scenarios: out })}\n`);
console.log(
  out
    .map(
      (s) =>
        `${s.id}: ${s.gdacs.length} alerts, ${s.news.length} news items, weather ${s.weather ? "yes" : "no"}`,
    )
    .join("\n"),
);
