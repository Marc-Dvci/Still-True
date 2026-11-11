// The fire drill: a queue replayed against a real past day, with the GDACS alerts, Wikipedia Current
// Events and archived weather recorded for that day. Everything runs on bundled data, so a drill is
// instant, free and gives the same answer every time.
import drills from "../../data/drills.json";
import { checkPost } from "../core/check";
import { weatherAt, type OpenMeteoHourly } from "../core/openmeteo";
import { parsePage } from "../core/page-parse";
import { remembranceDays } from "../core/remembrance";
import { addDays, localToInstant } from "../core/time";
import type { CheckContext, CheckResult, DisasterEvent, NewsItem, PageFacts, PostUnderCheck } from "../core/types";
import { extractLinks } from "../core/links";
import { renderDemoPage } from "./pages";

interface Scenario {
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
  gdacs: DisasterEvent[];
  news: NewsItem[];
  weather: OpenMeteoHourly | null;
  sources: Record<string, string | null>;
}

const SCENARIOS = (drills as unknown as { scenarios: Scenario[] }).scenarios;

export function drillScenarios() {
  return SCENARIOS.map((s) => ({
    id: s.id,
    title: s.title,
    date: s.date,
    place: s.place,
    country: s.country,
    summary: s.summary,
    sources: Object.values(s.sources).filter(Boolean),
  }));
}

export function findScenario(id: string): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

interface QueueItem {
  time: [number, number];
  channel: { name: string; service: string };
  text: string;
}

function sampleQueue(lang: "en" | "fr", origin: string): QueueItem[] {
  if (lang === "fr") {
    return [
      { time: [8, 0], channel: { name: "Café Rivage", service: "instagram" }, text: "Bonjour ! Les premiers croissants sortent du four." },
      { time: [9, 30], channel: { name: "Café Rivage", service: "facebook" }, text: "Vendredi 13 : vente flash, -30 % sur toute la boutique 🎉" },
      { time: [11, 0], channel: { name: "Café Rivage", service: "threads" }, text: "Nos prix sont en feu cette semaine 🔥 Passez nous voir." },
      { time: [14, 0], channel: { name: "Café Rivage", service: "instagram" }, text: "La terrasse est ouverte cet après-midi ☀️ Venez profiter du soleil." },
      { time: [17, 0], channel: { name: "Atelier Nord", service: "instagram" }, text: `De retour en stock : la chemise en lin naturel, 49 € ${origin}/demo/shop/linen-shirt` },
      { time: [18, 30], channel: { name: "Café Rivage", service: "facebook" }, text: "Ce soir à 18h : concert acoustique, entrée libre." },
      { time: [20, 30], channel: { name: "Café Rivage", service: "mastodon" }, text: "Ce matin, on a sorti les premières galettes. Merci d'être passés !" },
      { time: [21, 0], channel: { name: "Café Rivage", service: "bluesky" }, text: "Merci pour cette belle semaine. À lundi !" },
    ];
  }
  return [
    { time: [8, 0], channel: { name: "Corner Bakery", service: "instagram" }, text: "Good morning! Fresh sourdough is out of the oven." },
    { time: [9, 30], channel: { name: "Corner Bakery", service: "facebook" }, text: "Our prices are on fire this week 🔥 20% off everything in store." },
    { time: [11, 0], channel: { name: "Atelier Nord", service: "threads" }, text: `A wave of new arrivals just landed. Shop now: ${origin}/demo/shop/gift-card` },
    { time: [12, 30], channel: { name: "Corner Bakery", service: "twitter" }, text: "These deals will shake up your weekend. Buy two loaves, get one free." },
    { time: [14, 0], channel: { name: "Corner Bakery", service: "instagram" }, text: "Patio open this afternoon ☀️ Come soak up the sun." },
    { time: [17, 0], channel: { name: "Atelier Nord", service: "instagram" }, text: `Back in stock: our natural linen shirt, €49 ${origin}/demo/shop/linen-shirt` },
    { time: [18, 30], channel: { name: "Corner Bakery", service: "facebook" }, text: "Tonight at 6pm: live acoustic set, free entry." },
    { time: [20, 0], channel: { name: "Corner Bakery", service: "bluesky" }, text: "Thank you for a wonderful week. See you Monday!" },
  ];
}

export interface DrillPost {
  id: string;
  text: string;
  dueAt: string;
  channel: { name: string; service: string };
  result: CheckResult;
}

export interface DrillResult {
  scenario: ReturnType<typeof drillScenarios>[number] & { timezone: string; lang: string };
  posts: DrillPost[];
  counts: { hold: number; review: number; still_true: number };
}

export function contextFor(scenario: Scenario, post: PostUnderCheck, pages: Record<string, PageFacts>): CheckContext {
  return {
    country: scenario.country,
    pages,
    weather: scenario.weather ? weatherAt(scenario.weather, post.dueAt) : null,
    gdacs: scenario.gdacs,
    news: scenario.news,
    remembrance: remembranceDays(),
  };
}

function demoPagesFor(links: string[], origin: string, at: number): Record<string, PageFacts> {
  const pages: Record<string, PageFacts> = {};
  for (const url of links) {
    if (!url.startsWith(`${origin}/demo/`)) continue;
    const page = renderDemoPage(new URL(url).pathname, at);
    if (!page) {
      pages[url] = { status: 404, finalUrl: url };
      continue;
    }
    const parsed = parsePage(page.html);
    pages[url] = { status: 200, finalUrl: url, title: parsed.title, product: parsed.product, event: parsed.event };
  }
  return pages;
}

/** Replays `items` (or the sample queue) on the scenario's day, at the same local times of day. */
export function runDrill(
  id: string,
  origin: string,
  items?: { id: string; text: string; localTime: [number, number]; channel: { name: string; service: string } }[],
): DrillResult | null {
  const scenario = findScenario(id);
  if (!scenario) return null;
  const queue = items ?? sampleQueue(scenario.lang, origin).map((q, i) => ({ id: `sample-${i + 1}`, text: q.text, localTime: q.time, channel: q.channel }));
  const createdAt = localToInstant(addDays(scenario.date, -2), 9, 0, scenario.timezone).toISOString();
  const posts: DrillPost[] = queue.map((q) => {
    const dueAt = localToInstant(scenario.date, q.localTime[0], q.localTime[1], scenario.timezone).toISOString();
    const links = extractLinks(q.text, null);
    const post: PostUnderCheck = { id: q.id, text: q.text, createdAt, dueAt, firstSeenDueAt: null, service: q.channel.service, timezone: scenario.timezone, links };
    const pages = demoPagesFor(links, origin, Date.parse(dueAt));
    return { id: q.id, text: q.text, dueAt, channel: q.channel, result: checkPost(post, contextFor(scenario, post, pages)) };
  });
  const counts = { hold: 0, review: 0, still_true: 0 };
  for (const p of posts) counts[p.result.verdict] += 1;
  const meta = drillScenarios().find((s) => s.id === id) as ReturnType<typeof drillScenarios>[number];
  return { scenario: { ...meta, timezone: scenario.timezone, lang: scenario.lang }, posts, counts };
}
