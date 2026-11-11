import { describe, expect, it, vi } from "vitest";
import { cleanSuggestion, introducedClaims, suggestRewrite, type TextModel } from "../../src/ai/assist";
import type { Finding } from "../../src/core/types";

const finding: Finding = {
  detector: "weather",
  code: "weather_contradiction",
  verdict: "review",
  title: "The forecast says otherwise",
  detail: '"sunny" goes out into rain (rain 90 %).',
  evidence: [],
  spans: [],
};

const model = (response: string | Error): TextModel => ({
  run: vi.fn(async () => {
    if (response instanceof Error) throw response;
    return { response };
  }),
});

describe("suggestion guard", () => {
  it("lists numbers, links, handles, hashtags and weekdays the suggestion adds", () => {
    expect(introducedClaims("Terrace open, 10% off", "Cosy inside, 10% off")).toEqual([]);
    expect(
      introducedClaims("Terrace open", "Terrace open on Saturday, 20% off #sale @shop https://x.example"),
    ).toEqual(expect.arrayContaining(["saturday", "20", "#sale", "@shop", "https://x.example"]));
    expect(introducedClaims("Join us Friday", "Join us Saturday", ["Join us Saturday"])).toEqual([]);
  });

  it("strips quotes and preambles", () => {
    expect(cleanSuggestion('Here is the rewritten post: "Cosy inside today"')).toBe("Cosy inside today");
  });

  it("returns a clean suggestion", async () => {
    const result = await suggestRewrite(
      model("Cosy inside today, the coffee is on."),
      "Terrace open today ☀️",
      finding,
    );
    expect(result.text).toBe("Cosy inside today, the coffee is on.");
  });

  it("refuses a suggestion that adds a claim", async () => {
    const result = await suggestRewrite(
      model("Terrace open Saturday, 20% off"),
      "Terrace open today ☀️",
      finding,
    );
    expect(result.text).toBeNull();
    expect(result.reason).toContain("did not say");
  });

  it("refuses a suggestion much longer than the post", async () => {
    const result = await suggestRewrite(model("x".repeat(400)), "Terrace open today", finding);
    expect(result.text).toBeNull();
  });

  it("falls back to the next model, then explains that nothing came back", async () => {
    expect((await suggestRewrite(model(new Error("busy")), "Terrace open", finding)).text).toBeNull();
    expect((await suggestRewrite(undefined, "Terrace open", finding)).reason).toContain("unavailable");
  });
});
