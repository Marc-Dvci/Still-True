import { describe, expect, it } from "vitest";
import { drillScenarios, runDrill } from "../../src/demo/drill";
import { renderDemoPage } from "../../src/demo/pages";
import { sampleDrafts } from "../../src/demo/samples";
import { parsePage } from "../../src/core/page-parse";
import { checkPost } from "../../src/core/check";
import { ctx } from "./helpers";

const ORIGIN = "https://still-true.example";

describe("fire drill", () => {
  it("offers five real days", () => {
    expect(drillScenarios().map((s) => s.id)).toEqual([
      "los-angeles-2025-01-08",
      "valencia-2024-10-29",
      "turkiye-2023-02-06",
      "strasbourg-2025-06-15",
      "paris-2026-11-13",
    ]);
  });

  it.each([
    ["los-angeles-2025-01-08", { hold: 2, review: 3, still_true: 3 }],
    ["valencia-2024-10-29", { hold: 3, review: 3, still_true: 2 }],
    ["turkiye-2023-02-06", { hold: 2, review: 4, still_true: 2 }],
    ["strasbourg-2025-06-15", { hold: 1, review: 3, still_true: 4 }],
    ["paris-2026-11-13", { hold: 1, review: 3, still_true: 4 }],
  ])("%s replays to %j", (id, counts) => {
    expect(runDrill(id, ORIGIN)?.counts).toEqual(counts);
  });

  it("holds 'on fire' during the Los Angeles wildfires and lets the thank-you post through", () => {
    const posts = runDrill("los-angeles-2025-01-08", ORIGIN)?.posts ?? [];
    expect(posts.find((p) => p.text.includes("on fire"))?.result.findings.map((f) => f.code)).toContain(
      "disaster_wording_collision",
    );
    expect(posts.find((p) => p.text.startsWith("Thank you"))?.result.verdict).toBe("still_true");
  });

  it("replays a given queue at its own local times", () => {
    const result = runDrill("paris-2026-11-13", ORIGIN, [
      {
        id: "a",
        text: "Flash sale, 30% off 🎉",
        localTime: [10, 0],
        channel: { name: "Shop", service: "instagram" },
      },
    ]);
    expect(result?.posts[0]?.dueAt).toBe("2026-11-13T09:00:00.000Z");
    expect(result?.posts[0]?.result.verdict).toBe("review");
  });

  it("rejects an unknown scenario", () => {
    expect(runDrill("atlantis", ORIGIN)).toBeNull();
  });
});

describe("demo shop and sample drafts", () => {
  it("serves pages whose structured data the parser reads", () => {
    const now = Date.parse("2026-11-11T10:00:00Z");
    expect(parsePage(renderDemoPage("/demo/shop/linen-shirt", now)?.html ?? "").product?.availability).toBe(
      "OutOfStock",
    );
    expect(parsePage(renderDemoPage("/demo/events/jazz-night", now)?.html ?? "").event?.status).toBe(
      "EventPostponed",
    );
    const moved = parsePage(renderDemoPage("/demo/events/ceramics-workshop", now)?.html ?? "").event;
    expect(moved?.status).toBe("EventRescheduled");
    expect(moved?.startDate).toBe("2026-11-20T14:00:00+01:00");
    expect(renderDemoPage("/demo/shop/unknown", now)).toBeNull();
  });

  it("writes five drafts, each one tripping the check it was written for", () => {
    const now = Date.parse("2026-11-11T10:00:00Z");
    for (const draft of sampleDrafts(ORIGIN, "Europe/Paris", now)) {
      const links = draft.text.match(/https:\/\/\S+/g) ?? [];
      const pages = Object.fromEntries(
        links.map((url) => {
          const parsed = parsePage(renderDemoPage(new URL(url).pathname, now)?.html ?? "");
          return [url, { status: 200, finalUrl: url, product: parsed.product, event: parsed.event }];
        }),
      );
      const result = checkPost(
        {
          text: draft.text,
          dueAt: draft.dueAt,
          createdAt: new Date(now).toISOString(),
          service: "instagram",
          timezone: "Europe/Paris",
          links,
        },
        ctx({ pages }),
      );
      expect(result.findings.map((f) => f.code)).toContain(draft.expect);
    }
  });
});
