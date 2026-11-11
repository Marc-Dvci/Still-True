import { remembranceDays } from "../../src/core/remembrance";
import type { CheckContext, PostUnderCheck } from "../../src/core/types";

export function post(text: string, dueAt: string, extra: Partial<PostUnderCheck> = {}): PostUnderCheck {
  return {
    id: "p1",
    text,
    dueAt,
    createdAt: extra.createdAt ?? "2026-11-09T09:00:00+01:00",
    firstSeenDueAt: null,
    service: "instagram",
    timezone: "Europe/Paris",
    links: [],
    ...extra,
  };
}

export function ctx(extra: Partial<CheckContext> = {}): CheckContext {
  return {
    country: "FR",
    pages: {},
    weather: null,
    gdacs: [],
    news: [],
    remembrance: remembranceDays(),
    ...extra,
  };
}

export function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code).sort();
}
