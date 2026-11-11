// Open-Meteo hourly forecast or archive response -> the weather at a given instant.
import type { WeatherAtDue } from "./types";

export interface OpenMeteoHourly {
  utc_offset_seconds?: number;
  hourly?: {
    time?: string[];
    precipitation_probability?: (number | null)[];
    precipitation?: (number | null)[];
    weather_code?: (number | null)[];
    temperature_2m?: (number | null)[];
    cloud_cover?: (number | null)[];
    snowfall?: (number | null)[];
  };
}

function hourStart(response: OpenMeteoHourly, time: string): number {
  return Date.parse(`${time}Z`) - (response.utc_offset_seconds ?? 0) * 1000;
}

/** Index of the hour containing `instant`. Times are local to the response's utc_offset_seconds. */
export function hourIndex(response: OpenMeteoHourly, instant: string): number {
  const times = response.hourly?.time ?? [];
  const target = Date.parse(instant);
  for (let i = 0; i < times.length; i += 1) {
    const start = hourStart(response, times[i] as string);
    if (target >= start && target < start + 3_600_000) return i;
  }
  return -1;
}

export function weatherAt(response: OpenMeteoHourly, instant: string): WeatherAtDue | null {
  const i = hourIndex(response, instant);
  if (i < 0) return null;
  const h = response.hourly ?? {};
  const pick = (series: (number | null)[] | undefined): number | null => series?.[i] ?? null;
  return {
    precipProbability: pick(h.precipitation_probability),
    precipitationMm: pick(h.precipitation),
    weatherCode: pick(h.weather_code),
    temperatureC: pick(h.temperature_2m),
    cloudCover: pick(h.cloud_cover),
    snowfallCm: pick(h.snowfall),
    time: h.time?.[i] ?? null,
  };
}

/**
 * The first later daytime hour (09:00 to 19:00 in `timeZone`) within `withinHours` that reads as dry
 * and bright: WMO code 0 to 2, rain probability under 30 %, cloud cover under 70 %.
 */
export function nextFairHour(
  response: OpenMeteoHourly,
  from: string,
  timeZone: string,
  withinHours = 72,
): string | null {
  const start = hourIndex(response, from);
  if (start < 0) return null;
  const h = response.hourly ?? {};
  const times = h.time ?? [];
  const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" });
  for (let i = start + 1; i < Math.min(times.length, start + withinHours); i += 1) {
    const instant = hourStart(response, times[i] as string);
    const hour = Number(hourFormat.format(instant));
    if (hour < 9 || hour > 19) continue;
    const code = h.weather_code?.[i] ?? null;
    const pop = h.precipitation_probability?.[i] ?? 0;
    const cloud = h.cloud_cover?.[i] ?? 0;
    if (code !== null && code <= 2 && pop < 30 && cloud < 70) return new Date(instant).toISOString();
  }
  return null;
}
