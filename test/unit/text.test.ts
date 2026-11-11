import { describe, expect, it } from "vitest";
import { countryForTimeZone } from "../../src/core/country";
import { findDates, findRelative, findTimes, relativeKeys, resolveYear } from "../../src/core/datetext";
import { extractLinks, linksInText, normaliseUrl } from "../../src/core/links";
import {
  findAll,
  fold,
  isPlayful,
  isPromotional,
  isSupportive,
  maskUrls,
  matchCase,
  sentences,
} from "../../src/core/text";
import {
  addDays,
  daysBetween,
  formatLocalDate,
  isRealDate,
  isValidTimeZone,
  localParts,
  localToInstant,
  weekdayOf,
} from "../../src/core/time";

describe("text folding and spans", () => {
  it("folds accents and case without changing length, so spans point at the original", () => {
    const text = "Prix BRÛLANTS 🔥 à Noël";
    expect(fold(text)).toHaveLength(text.length);
    expect(fold(text)).toContain("brulants");
    const [m] = findAll(text, /brulants/);
    expect(m && text.slice(m.start, m.end)).toBe("BRÛLANTS");
  });

  it("masks links with spaces of the same length", () => {
    const text = "See https://a.example/2026/11/14 now";
    expect(maskUrls(text)).toHaveLength(text.length);
    expect(maskUrls(text)).not.toContain("2026");
  });

  it("splits sentences with their offsets", () => {
    const parts = sentences("One. Two!\nThree");
    expect(parts.map((p) => p.text.trim())).toEqual(["One.", "Two!", "Three"]);
  });

  it("keeps the case style of the word it replaces", () => {
    expect(matchCase("saturday", "FRIDAY")).toBe("SATURDAY");
    expect(matchCase("saturday", "Friday")).toBe("Saturday");
    expect(matchCase("Saturday", "friday")).toBe("saturday");
  });
});

describe("tone", () => {
  it.each([
    "Flash sale today",
    "-30 % sur tout",
    "20% off",
    "Code WELCOME10 at checkout",
    "Soldes d'hiver",
    "Jeu concours !",
  ])("'%s' is promotional", (text) => expect(isPromotional(text)).toBe(true));

  it.each(["Meet our sales team", "New loaves every morning", "Doors at 7"])(
    "'%s' is not promotional",
    (text) => expect(isPromotional(text)).toBe(false),
  );

  it("recognises playful and supportive posts", () => {
    expect(isPlayful("Party time 🎉")).toBe(true);
    expect(isPlayful("Quiet evening")).toBe(false);
    expect(isSupportive("Our thoughts are with everyone affected")).toBe(true);
    expect(isSupportive("Nous serons fermés aujourd'hui")).toBe(true);
    expect(isSupportive("Shop now")).toBe(false);
  });
});

describe("dates, relative days and times", () => {
  it("infers the year nearest the publish date", () => {
    expect(resolveYear(5, 1, "2026-12-20")).toBe(2027);
    expect(resolveYear(1, 12, "2026-12-03")).toBe(2026);
    expect(resolveYear(20, 12, "2027-01-05")).toBe(2026);
  });

  it("finds dates in every written form", () => {
    const keys = (t: string) => findDates(t, "2026-11-12").map((d) => d.key);
    expect(keys("Friday 14 November")).toEqual(["2026-11-14"]);
    expect(keys("vendredi 1er décembre")).toEqual(["2026-12-01"]);
    expect(keys("Nov 14th, 2027")).toEqual(["2027-11-14"]);
    expect(keys("le 14/11")).toEqual(["2026-11-14"]);
    expect(keys("31 November")).toEqual([]);
  });

  it("resolves relative days on the publish date", () => {
    const [tomorrow] = findRelative("See you tomorrow");
    expect(tomorrow && relativeKeys(tomorrow, "2026-11-13")).toEqual(["2026-11-14"]);
    const [weekend] = findRelative("ce week-end");
    expect(weekend && relativeKeys(weekend, "2026-11-12")).toEqual(["2026-11-14", "2026-11-15"]);
    expect(weekend && relativeKeys(weekend, "2026-11-14")).toEqual(["2026-11-14", "2026-11-15"]);
    expect(weekend && relativeKeys(weekend, "2026-11-15")).toEqual(["2026-11-15"]);
    expect(findRelative("après-demain")[0]?.offset).toBe(2);
  });

  it("reads 12-hour, 24-hour and French times", () => {
    expect(findTimes("at 7:30pm").map((t) => t.minutes)).toEqual([19 * 60 + 30]);
    expect(findTimes("à 20h30").map((t) => t.minutes)).toEqual([20 * 60 + 30]);
    expect(findTimes("12am and 12pm").map((t) => t.minutes)).toEqual([0, 12 * 60]);
    expect(findTimes("from 18:00").map((t) => t.minutes)).toEqual([18 * 60]);
    expect(findTimes("tonight at 7", true).map((t) => t.minutes)).toEqual([19 * 60]);
    expect(findTimes("tonight at 7", false)).toEqual([]);
  });
});

describe("time zones and calendar arithmetic", () => {
  it("reads local parts in a channel's timezone", () => {
    expect(localParts("2027-01-12T09:30:00Z", "Australia/Sydney")).toMatchObject({
      date: "2027-01-12",
      hour: 20,
      minute: 30,
      weekday: 2,
    });
  });

  it("converts local wall-clock time to an instant across daylight saving", () => {
    expect(localToInstant("2026-07-01", 9, 0, "Europe/Paris").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(localToInstant("2026-12-01", 9, 0, "Europe/Paris").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("does calendar arithmetic", () => {
    expect(weekdayOf("2026-11-14")).toBe(6);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-12", "2026-11-15")).toBe(3);
    expect(isRealDate(2027, 2, 29)).toBe(false);
    expect(formatLocalDate("2026-11-14", "fr")).toBe("samedi 14 novembre");
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("maps timezones to countries from the IANA table", () => {
    expect(countryForTimeZone("Europe/Paris")).toBe("FR");
    expect(countryForTimeZone("America/Los_Angeles")).toBe("US");
    expect(countryForTimeZone("Nowhere/City")).toBeNull();
  });
});

describe("links", () => {
  it("extracts links from text and from network link fields, without trailing punctuation", () => {
    expect(linksInText("Read https://a.example/x. Or www.b.example/y!")).toEqual([
      "https://a.example/x",
      "https://www.b.example/y",
    ]);
    expect(
      extractLinks("https://a.example/x", {
        linkAttachment: { url: "https://c.example/z" },
        link: "https://a.example/x",
      }),
    ).toEqual(["https://a.example/x", "https://c.example/z"]);
    expect(normaliseUrl("javascript:alert(1)")).toBeNull();
    expect(extractLinks("no links", null)).toEqual([]);
  });
});
