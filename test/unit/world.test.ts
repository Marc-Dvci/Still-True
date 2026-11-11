import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recentEvents, remembranceFindings, worldFindings } from "../../src/core/detectors/world";
import { gdacsDate, parseGdacs } from "../../src/core/gdacs";
import { remembranceDays } from "../../src/core/remembrance";
import type { DisasterEvent } from "../../src/core/types";
import { currentEventsTitle, parseCurrentEvents, plainText } from "../../src/core/wikinews";
import { codes, ctx, post } from "./helpers";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8")) as unknown;
const wikitext = (day: string) =>
  (json(`wikipedia/${day}.json`) as { parse: { wikitext: string } }).parse.wikitext;

const wildfire: DisasterEvent = {
  type: "WF",
  alert: "orange",
  countries: ["US"],
  name: "Forest fires in United States",
  from: "2025-01-07T00:00:00.000Z",
};
const quake: DisasterEvent = {
  type: "EQ",
  alert: "red",
  countries: ["TR"],
  name: "Earthquake in Türkiye",
  from: "2023-02-06T01:17:00.000Z",
};

describe("GDACS", () => {
  it("parses the recorded Los Angeles wildfire alerts with their countries", () => {
    const events = parseGdacs(json("gdacs/la-wildfires-2025-01.json"));
    expect(events.filter((e) => e.type === "WF" && e.countries.includes("US")).length).toBe(2);
    expect(events.every((e) => !Number.isNaN(Date.parse(e.from)))).toBe(true);
  });

  it("reads the red Türkiye earthquake of 6 February 2023", () => {
    const events = parseGdacs(json("gdacs/turkey-eq-2023-02.json"));
    expect(events.some((e) => e.type === "EQ" && e.alert === "red" && e.countries.includes("TR"))).toBe(true);
  });

  it("treats GDACS dates as UTC and ignores malformed input", () => {
    expect(gdacsDate("2025-01-07T00:00:00")).toBe("2025-01-07T00:00:00.000Z");
    expect(gdacsDate(undefined)).toBeNull();
    expect(gdacsDate("not a date")).toBeNull();
    expect(parseGdacs(null)).toEqual([]);
    expect(
      parseGdacs({
        features: [{ properties: { eventtype: "XX", alertlevel: "Red", fromdate: "2025-01-01" } }],
      }),
    ).toEqual([]);
  });

  it("keeps only events that began in the 72 hours before the post, in the audience's country", () => {
    expect(recentEvents([wildfire], "US", "2025-01-09T23:59:00Z")).toHaveLength(1);
    expect(recentEvents([wildfire], "US", "2025-01-10T00:00:01Z")).toHaveLength(0);
    expect(recentEvents([wildfire], "US", "2025-01-06T23:00:00Z")).toHaveLength(0);
    expect(recentEvents([wildfire], "FR", "2025-01-08T12:00:00Z")).toHaveLength(0);
  });
});

describe("Wikipedia Current Events", () => {
  it("locates the 13 November 2015 Paris attacks in France", () => {
    const items = parseCurrentEvents(wikitext("2015_November_13"), "2015-11-13");
    expect(items.some((i) => i.category === "attacks" && i.countries.includes("FR"))).toBe(true);
  });

  it("locates the Los Angeles wildfires in the United States", () => {
    const items = parseCurrentEvents(wikitext("2025_January_8"), "2025-01-08");
    expect(items.some((i) => i.category === "disasters" && i.countries.includes("US"))).toBe(true);
  });

  it("does not place an event in every country it mentions", () => {
    const items = parseCurrentEvents(wikitext("2015_November_13"), "2015-11-13");
    const iraq = items.find((i) => i.headline.includes("Baghdad"));
    expect(iraq?.countries ?? []).not.toContain("US");
  });

  it("skips items with no harm, and items it cannot locate", () => {
    expect(
      parseCurrentEvents("*[[Monetary policy]]\n**The central bank raises rates.", "2026-11-10"),
    ).toEqual([]);
    expect(parseCurrentEvents("*An explosion kills three people somewhere.", "2026-11-10")).toEqual([]);
  });

  it("strips wiki markup and builds page titles", () => {
    expect(plainText("[[Paris|the capital]] and '''bold''' [https://x.example (BBC)]")).toBe(
      "the capital and bold",
    );
    expect(currentEventsTitle("2026-11-10")).toBe("Portal:Current_events/2026_November_10");
  });
});

describe("disaster and news checks", () => {
  const due = "2025-01-08T17:30:00Z";
  const run = (text: string, extra = {}) =>
    worldFindings(
      post(text, due, { timezone: "America/Los_Angeles" }),
      ctx({ country: "US", gdacs: [wildfire], ...extra }),
    );

  it("holds wording that echoes the active hazard", () => {
    const [f] = run("Our prices are on fire this week 🔥");
    expect(f?.code).toBe("disaster_wording_collision");
    expect(f?.verdict).toBe("hold");
  });

  it("matches the hazard type: flood words do not collide with a wildfire", () => {
    expect(run("A wave of new arrivals")).toEqual([]);
  });

  it("flags promotions during a red alert, and not during an orange one", () => {
    const red = worldFindings(
      post("Flash sale: 20% off everything", "2023-02-06T12:00:00Z", { timezone: "Europe/Istanbul" }),
      ctx({ country: "TR", gdacs: [quake] }),
    );
    expect(codes(red)).toEqual(["disaster_promo_window"]);
    expect(run("Flash sale: 20% off everything")).toEqual([]);
  });

  it("never flags supportive posts", () => {
    expect(run("Our thoughts are with everyone affected by the fires. We are collecting donations.")).toEqual(
      [],
    );
  });

  it("says nothing about the same post in a country without an alert", () => {
    expect(
      worldFindings(post("Our prices are on fire 🔥", due), ctx({ country: "FR", gdacs: [wildfire] })),
    ).toEqual([]);
  });

  it("flags a promotion on the day the news names the audience's country", () => {
    const news = [
      {
        date: "2025-01-08",
        category: "disasters" as const,
        countries: ["US"],
        headline: "Wildfires force evacuations",
      },
    ];
    expect(codes(run("Shop now: new arrivals", { gdacs: [], news }))).toEqual(["major_news_window"]);
    expect(run("New arrivals in store", { gdacs: [], news })).toEqual([]);
  });
});

describe("remembrance days", () => {
  it("covers 31 sourced days", () => {
    const days = remembranceDays();
    expect(days.length).toBe(31);
    expect(days.every((d) => d.source?.startsWith("http"))).toBe(true);
  });

  it("flags a promotion in France on 13 November", () => {
    const [f] = remembranceFindings(
      post("Vendredi 13 : vente flash, -30 % 🎉", "2026-11-13T09:30:00+01:00"),
      ctx(),
    );
    expect(f?.code).toBe("remembrance_day_tone");
  });

  it("does not flag the same promotion for another country, another day, or a respectful post", () => {
    expect(
      remembranceFindings(
        post("Flash sale, 30% off", "2026-11-13T09:30:00-05:00", { timezone: "America/New_York" }),
        ctx({ country: "US" }),
      ),
    ).toEqual([]);
    expect(
      remembranceFindings(post("Vendredi 13 : vente flash", "2026-11-20T09:30:00+01:00"), ctx()),
    ).toEqual([]);
    expect(
      remembranceFindings(
        post("Nous serons fermés aujourd'hui, en mémoire des victimes.", "2026-11-13T09:30:00+01:00"),
        ctx(),
      ),
    ).toEqual([]);
  });

  it("applies the UN Holocaust Remembrance Day to every country", () => {
    expect(
      codes(
        remembranceFindings(
          post("Giveaway time! 🎉", "2027-01-27T10:00:00-05:00", { timezone: "America/Toronto" }),
          ctx({ country: "CA" }),
        ),
      ),
    ).toEqual(["remembrance_day_tone"]);
  });
});

describe("wording helpers", () => {
  it("names countries in plain English", async () => {
    const { countryName, utcLabel } = await import("../../src/core/detectors/world");
    expect(countryName("US")).toBe("the United States");
    expect(countryName("FR")).toBe("France");
    expect(countryName("not-a-code")).toBe("not-a-code");
    expect(utcLabel("2025-01-07T00:00:00.000Z")).toBe("7 Jan 2025, 00:00 UTC");
    expect(utcLabel("garbage")).toBe("garbage");
  });
});
