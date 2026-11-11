// One shared Durable Object for the facts about the world: GDACS disaster alerts and Wikipedia's
// Current Events. It refreshes on its own alarm every 30 minutes, so the number of calls to those
// services does not grow with the number of connected accounts.
import { DurableObject } from "cloudflare:workers";
import { parseGdacs } from "../core/gdacs";
import { addDays, localParts } from "../core/time";
import type { DisasterEvent, NewsItem } from "../core/types";
import { currentEventsTitle, parseCurrentEvents } from "../core/wikinews";
import type { Env } from "../env";

export const GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";
export const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "StillTrue/1.0 (https://still-true.chatisthisreal.workers.dev/about)";
const REFRESH_MS = 30 * 60_000;
const STALE_MS = 45 * 60_000;

export interface WorldSnapshot {
  gdacs: DisasterEvent[];
  news: NewsItem[];
  refreshedAt: string | null;
  sources: { gdacs: "ok" | "unavailable"; news: "ok" | "unavailable" };
}

export function gdacsUrl(now: number): string {
  const today = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - 10 * 86_400_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({ eventlist: "EQ;TC;FL;VO;WF;DR", alertlevel: "Orange;Red", fromdate: from, todate: today });
  return `${GDACS_URL}?${params}`;
}

export function wikipediaUrl(dateKey: string): string {
  const params = new URLSearchParams({
    action: "parse",
    page: currentEventsTitle(dateKey),
    prop: "wikitext",
    format: "json",
    formatversion: "2",
  });
  return `${WIKIPEDIA_API}?${params}`;
}

export class WorldDO extends DurableObject<Env> {
  async snapshot(): Promise<WorldSnapshot> {
    const cached = await this.ctx.storage.get<WorldSnapshot>("snapshot");
    if (cached?.refreshedAt && Date.now() - Date.parse(cached.refreshedAt) < STALE_MS) return cached;
    return this.refresh();
  }

  override async alarm(): Promise<void> {
    await this.refresh();
  }

  async refresh(fetchImpl: typeof fetch = fetch): Promise<WorldSnapshot> {
    const previous = await this.ctx.storage.get<WorldSnapshot>("snapshot");
    const now = Date.now();
    let gdacs = previous?.gdacs ?? [];
    let news = previous?.news ?? [];
    const sources: WorldSnapshot["sources"] = { gdacs: "unavailable", news: "unavailable" };

    try {
      const response = await fetchImpl(gdacsUrl(now), {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        gdacs = parseGdacs(await response.json());
        sources.gdacs = "ok";
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: "gdacs_failed", message: (error as Error).message }));
    }

    const today = localParts(now, "UTC").date;
    const days = [addDays(today, -1), today];
    const collected: NewsItem[] = [];
    let anyNews = false;
    for (const day of days) {
      try {
        const response = await fetchImpl(wikipediaUrl(day), {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { parse?: { wikitext?: string } };
        if (body.parse?.wikitext) {
          collected.push(...parseCurrentEvents(body.parse.wikitext, day));
          anyNews = true;
        }
      } catch (error) {
        console.warn(JSON.stringify({ event: "wikipedia_failed", day, message: (error as Error).message }));
      }
    }
    if (anyNews) {
      news = collected;
      sources.news = "ok";
    }

    const snapshot: WorldSnapshot = { gdacs, news, refreshedAt: new Date(now).toISOString(), sources };
    await this.ctx.storage.put("snapshot", snapshot);
    await this.ctx.storage.setAlarm(now + REFRESH_MS);
    return snapshot;
  }
}
