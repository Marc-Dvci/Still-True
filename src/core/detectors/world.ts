// Remembrance days and the world's news: tone against what the audience's country is living through.
import { findAll, isPlayful, isPromotional, isSupportive } from "../text";
import { addDays, formatLocalDate, localParts } from "../time";
import type { CheckContext, DisasterEvent, Finding, HazardType, PostUnderCheck } from "../types";

const HAZARD_WORDS: Record<HazardType, RegExp> = {
  WF: /\b(fires?|on fire|blaz(?:e|es|ing)|burn(?:s|ing|t)?|hot deals?|lit|smoking hot|feux?|en feu|brulant(?:e|s|es)?|incendi(?:e|es)|flamb(?:e|ee|es|ees|ent))\b|\u{1F525}/u,
  FL: /\b(flood(?:s|ed|ing)?|waves?|splash(?:es|ing)?|drowning in|soak(?:s|ed|ing)?|inondations?|inonde(?:s|e|es)?|vagues?|deluges?)\b|\u{1F30A}/u,
  EQ: /\b(shak(?:e|es|ing|en)|earth-?shattering|quakes?|rock your world|ground-?breaking|secousses?|seismes?|trembl(?:er|e|ent))\b/u,
  TC: /\b(storm(?:s|ing|y)?|whirlwinds?|blow you away|blown away|hurricanes?|typhoons?|tempetes?|ouragans?|tourbillons?)\b|\u{1F32A}/u,
  VO: /\b(explosive|erupt|eruption|lava)\b|\u{1F30B}/u,
  DR: /\b(drought|dry spell|thirsty|secheresse)\b/u,
};

const HAZARD_NAMES: Record<HazardType, string> = {
  WF: "wildfire",
  FL: "flood",
  EQ: "earthquake",
  TC: "tropical cyclone",
  VO: "volcanic eruption",
  DR: "drought",
};

const WINDOW_MS = 72 * 3_600_000;

function affects(event: DisasterEvent, country: string): boolean {
  return event.countries.includes(country);
}

/** Events in the audience's country that began in the 72 hours before the post goes out. */
export function recentEvents(events: DisasterEvent[], country: string, dueAt: string): DisasterEvent[] {
  const due = Date.parse(dueAt);
  return events.filter((e) => {
    const from = Date.parse(e.from);
    return affects(e, country) && from <= due && due - from <= WINDOW_MS;
  });
}

export function worldFindings(post: PostUnderCheck, ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const supportive = isSupportive(post.text);
  if (supportive) return findings;
  const promotional = isPromotional(post.text);
  const playful = isPlayful(post.text);

  const events = recentEvents(ctx.gdacs, ctx.country, post.dueAt).filter((e) => e.alert === "red" || e.alert === "orange");
  let collided = false;
  for (const event of events) {
    const words = findAll(post.text, HAZARD_WORDS[event.type]);
    if (words.length === 0) continue;
    collided = true;
    findings.push({
      detector: "world",
      code: "disaster_wording_collision",
      verdict: "hold",
      title: `Wording echoes an active ${HAZARD_NAMES[event.type]}`,
      detail: `"${words[0]?.text}" while GDACS reports a ${event.alert} ${HAZARD_NAMES[event.type]} alert in ${ctx.country}: ${event.name}.`,
      evidence: [
        { label: "Alert", value: `${event.alert} · ${event.name}`, source: event.url ?? "https://www.gdacs.org/" },
        { label: "Started", value: event.from },
      ],
      spans: words.map((w) => [w.start, w.end] as [number, number]),
    });
    break;
  }
  if (!collided && promotional) {
    const red = events.find((e) => e.alert === "red");
    if (red) {
      findings.push({
        detector: "world",
        code: "disaster_promo_window",
        verdict: "review",
        title: `Promotion during a ${HAZARD_NAMES[red.type]}`,
        detail: `GDACS reports a red ${HAZARD_NAMES[red.type]} alert in ${ctx.country}: ${red.name}.`,
        evidence: [
          { label: "Alert", value: `red · ${red.name}`, source: red.url ?? "https://www.gdacs.org/" },
          { label: "Started", value: red.from },
        ],
        spans: [],
      });
    }
  }

  if (promotional || playful) {
    const dueKey = localParts(post.dueAt, post.timezone).date;
    const days = new Set([dueKey, addDays(dueKey, -1)]);
    const item = ctx.news.find(
      (n) => (n.category === "attacks" || n.category === "disasters") && days.has(n.date) && n.countries.includes(ctx.country),
    );
    if (item) {
      findings.push({
        detector: "world",
        code: "major_news_window",
        verdict: "review",
        title: item.category === "attacks" ? "Promotion on a day of an attack" : "Promotion on a day of a disaster",
        detail: `Wikipedia's Current Events for ${formatLocalDate(item.date)}: ${item.headline}`,
        evidence: [
          { label: "News", value: item.headline, source: item.url ?? "https://en.wikipedia.org/wiki/Portal:Current_events" },
        ],
        spans: [],
      });
    }
  }
  return findings;
}

export function remembranceFindings(post: PostUnderCheck, ctx: CheckContext): Finding[] {
  if (!isPromotional(post.text) && !isPlayful(post.text)) return [];
  if (isSupportive(post.text)) return [];
  const dueKey = localParts(post.dueAt, post.timezone).date;
  const day = ctx.remembrance.find(
    (d) => d.dates.includes(dueKey) && (d.countries.length === 0 || d.countries.includes(ctx.country)),
  );
  if (!day) return [];
  return [
    {
      detector: "remembrance",
      code: "remembrance_day_tone",
      verdict: "review",
      title: "Promotion on a day of remembrance",
      detail: `${formatLocalDate(dueKey)} is ${day.name}${day.localName && day.localName !== day.name ? ` (${day.localName})` : ""}.`,
      evidence: [{ label: "Remembrance", value: day.name, source: day.source ?? null }],
      spans: [],
    },
  ];
}
