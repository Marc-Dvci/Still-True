import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeWeather, weatherFindings } from "../../src/core/detectors/weather";
import { hourIndex, nextFairHour, weatherAt, type OpenMeteoHourly } from "../../src/core/openmeteo";
import type { WeatherAtDue } from "../../src/core/types";
import { codes, ctx, post } from "./helpers";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/openmeteo/${name}`, import.meta.url), "utf8"),
  ) as OpenMeteoHourly;

const dry: WeatherAtDue = {
  precipProbability: 5,
  precipitationMm: 0,
  weatherCode: 1,
  temperatureC: 21,
  cloudCover: 20,
  snowfallCm: 0,
};
const run = (text: string, weather: WeatherAtDue | null) =>
  weatherFindings(post(text, "2026-06-14T14:00:00+02:00"), ctx({ weather }));

describe("Open-Meteo responses", () => {
  it("finds the hour that contains an instant, in a UTC response", () => {
    const archive = fixture("archive-strasbourg-2025-06-14.json");
    const i = hourIndex(archive, "2025-06-15T15:30:00+02:00"); // 13:30 UTC
    expect(archive.hourly?.time?.[i]).toBe("2025-06-15T13:00");
    expect(hourIndex(archive, "2030-01-01T00:00:00Z")).toBe(-1);
  });

  it("reads the recorded storm over Strasbourg on 15 June 2025", () => {
    const at = weatherAt(fixture("archive-strasbourg-2025-06-14.json"), "2025-06-15T16:00:00+02:00");
    expect(at?.weatherCode).toBeGreaterThanOrEqual(51);
    expect(at?.precipProbability).toBeNull(); // the archive has no probability, only what fell
  });

  it("proposes the next dry, bright daytime hour from a live forecast", () => {
    const forecast = fixture("forecast-strasbourg.json");
    const first = forecast.hourly?.time?.[0] as string;
    const slot = nextFairHour(forecast, `${first}:00Z`, "Europe/Paris", 160);
    if (slot) {
      const i = hourIndex(forecast, slot);
      expect(forecast.hourly?.weather_code?.[i]).toBeLessThanOrEqual(2);
      expect(forecast.hourly?.precipitation_probability?.[i]).toBeLessThan(30);
    }
    expect(nextFairHour(forecast, "2000-01-01T00:00:00Z", "Europe/Paris")).toBeNull();
  });

  it("names WMO weather codes", () => {
    expect(describeWeather(63)).toBe("rain");
    expect(describeWeather(null)).toBe("unknown");
    expect(describeWeather(42)).toBe("WMO code 42");
  });
});

describe("weather check", () => {
  it("flags sunshine into rain, and proposes the next fair slot when there is one", () => {
    const [f] = run("Terrace open this afternoon ☀️", {
      ...dry,
      precipProbability: 90,
      weatherCode: 63,
      nextFair: "2026-06-15T09:00:00.000Z",
    });
    expect(f?.code).toBe("weather_contradiction");
    expect(f?.fix).toMatchObject({ kind: "reschedule", dueAt: "2026-06-15T09:00:00.000Z" });
  });

  it("words the hour from what the source has: a forecast's probability, or an archive's millimetres", () => {
    const [forecast] = run("Terrace open this afternoon ☀️", {
      ...dry,
      precipProbability: 90,
      weatherCode: 63,
    });
    expect(forecast?.detail).toBe('"Terrace" goes out into rain (rain 90 %).');
    expect(forecast?.evidence[0]?.value).toBe("rain, rain 90 %, cloud 20 %, 21 °C");

    // The historical archive has no rain probability: the measured amount is given instead, never "?".
    const archive = { ...dry, precipProbability: null, precipitationMm: 0.1, weatherCode: 51 };
    const [recorded] = run("☀️ La terrasse est ouverte", archive);
    expect(recorded?.detail).toBe('"terrasse" goes out into light drizzle (0.1 mm of rain).');
    expect(recorded?.evidence[0]?.value).toBe("light drizzle, 0.1 mm of rain, cloud 20 %, 21 °C");

    const bare = {
      ...dry,
      precipProbability: null,
      precipitationMm: null,
      cloudCover: null,
      weatherCode: 61,
    };
    const [unknown] = run("Picnic in the park today", bare);
    expect(unknown?.detail).toBe('"Picnic" goes out into light rain.');
    expect(unknown?.evidence[0]?.value).toBe("light rain, 21 °C");
    expect(JSON.stringify([forecast, recorded, unknown])).not.toContain("?");
  });

  it("flags at 60 % rain and not at 59 %", () => {
    expect(codes(run("Picnic in the park today", { ...dry, precipProbability: 60 }))).toEqual([
      "weather_contradiction",
    ]);
    expect(run("Picnic in the park today", { ...dry, precipProbability: 59 })).toEqual([]);
  });

  it("flags 'sunny' under a fully grey sky, but not an outdoor plan without sun words", () => {
    expect(codes(run("Sunny afternoon on the patio", { ...dry, cloudCover: 95 }))).toEqual([
      "weather_contradiction",
    ]);
    expect(run("Our patio is open", { ...dry, cloudCover: 95 })).toEqual([]);
  });

  it("reads French", () => {
    expect(codes(run("La terrasse est ouverte, profitez du soleil", { ...dry, weatherCode: 80 }))).toEqual([
      "weather_contradiction",
    ]);
  });

  it("flags a snow day with no snow above 3 °C", () => {
    expect(codes(run("Snow day! Hot chocolate on us", { ...dry, temperatureC: 8 }))).toEqual([
      "weather_contradiction",
    ]);
    expect(run("Snow day! Hot chocolate on us", { ...dry, temperatureC: 1, snowfallCm: 2 })).toEqual([]);
  });

  it("stays silent with fair weather, with no forecast, and for posts without weather words", () => {
    expect(run("Terrace open this afternoon ☀️", dry)).toEqual([]);
    expect(run("Terrace open this afternoon ☀️", null)).toEqual([]);
    expect(run("New loaves every morning", { ...dry, weatherCode: 65 })).toEqual([]);
  });
});
