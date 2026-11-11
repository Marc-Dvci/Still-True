// Forecast for the business location at the post's due hour, from Open-Meteo (no key; attribution on
// the About page). One forecast per location per hour, cached in the account's Durable Object storage.
import { nextFairHour, weatherAt, type OpenMeteoHourly } from "../core/openmeteo";
import type { WeatherAtDue } from "../core/types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const HOURLY = "precipitation_probability,precipitation,weather_code,temperature_2m,cloud_cover,snowfall";
const HORIZON_MS = 15 * 86_400_000;

export function forecastUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(3),
    longitude: longitude.toFixed(3),
    hourly: HOURLY,
    timezone: "UTC",
    forecast_days: "16",
  });
  return `${FORECAST_URL}?${params}`;
}

export interface ForecastCache {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export async function forecast(
  latitude: number,
  longitude: number,
  options: { cache?: ForecastCache; now: number; fetchImpl?: typeof fetch },
): Promise<OpenMeteoHourly | null> {
  const key = `forecast:${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = await options.cache?.get<{ at: number; body: OpenMeteoHourly }>(key);
  if (cached && options.now - cached.at < 60 * 60_000) return cached.body;
  try {
    const response = await (options.fetchImpl ?? fetch)(forecastUrl(latitude, longitude), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return cached?.body ?? null;
    const body = (await response.json()) as OpenMeteoHourly;
    await options.cache?.put(key, { at: options.now, body });
    return body;
  } catch {
    return cached?.body ?? null;
  }
}

export type WeatherWithFairSlot = WeatherAtDue & { nextFair: string | null };

export async function weatherAtDue(
  latitude: number,
  longitude: number,
  dueAt: string,
  timeZone: string,
  options: { cache?: ForecastCache; now: number; fetchImpl?: typeof fetch },
): Promise<WeatherWithFairSlot | null> {
  const due = Date.parse(dueAt);
  if (due - options.now > HORIZON_MS || due < options.now - 3_600_000) return null;
  const body = await forecast(latitude, longitude, options);
  if (!body) return null;
  const at = weatherAt(body, dueAt);
  return at ? { ...at, nextFair: nextFairHour(body, dueAt, timeZone) } : null;
}
