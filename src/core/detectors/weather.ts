// Weather: sunshine and outdoor plans against the forecast for the hour the post goes out.
import { findAll } from "../text";
import { formatLocalDate, localParts } from "../time";
import type { CheckContext, Finding, PostUnderCheck } from "../types";

const SUNNY =
  /\b(sunny|sunshine|sun'?s out|sun is out|soak up the sun|blue skies?|ensoleille|soleil|sol y|sonne|sonnig)\b|☀/u;
const OUTDOOR =
  /\b(terrace|patio|rooftop|beer garden|outdoor seating|garden is open|al fresco|picnic|bbq|barbecue|beach day|terrasse|pique-?nique|plein air|en exterieur|terraza|biergarten)\b/;
const SNOW = /\b(snow day|snowy|let it snow|fresh snow|neige|enneige)\b/;

const WET_CODES = (code: number): boolean =>
  (code >= 51 && code <= 67) ||
  (code >= 71 && code <= 77) ||
  (code >= 80 && code <= 86) ||
  (code >= 95 && code <= 99);

const WMO: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "dense drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

export function describeWeather(code: number | null): string {
  return code === null ? "unknown" : (WMO[code] ?? `WMO code ${code}`);
}

/** The rain for the hour in words: the forecast's probability, or the archive's measured amount. */
function rainNote(w: NonNullable<CheckContext["weather"]>): string | null {
  if (w.precipProbability !== null) return `rain ${w.precipProbability} %`;
  if (w.precipitationMm !== null) return `${w.precipitationMm} mm of rain`;
  return null;
}

function describeHour(w: NonNullable<CheckContext["weather"]>): string {
  return [
    describeWeather(w.weatherCode),
    rainNote(w),
    w.cloudCover !== null ? `cloud ${w.cloudCover} %` : null,
    w.temperatureC !== null ? `${w.temperatureC} °C` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function weatherFindings(post: PostUnderCheck, ctx: CheckContext): Finding[] {
  const w = ctx.weather;
  if (!w) return [];
  const sunny = findAll(post.text, SUNNY);
  const outdoor = findAll(post.text, OUTDOOR);
  const snow = findAll(post.text, SNOW);
  const evidence = [
    {
      label: "Forecast at that hour",
      value: describeHour(w),
    },
    { label: "Source", value: "Open-Meteo", source: "https://open-meteo.com/" },
  ];
  const wet = (w.precipProbability ?? 0) >= 60 || (w.weatherCode !== null && WET_CODES(w.weatherCode));
  const grey = (w.cloudCover ?? 0) >= 90;

  if ((sunny.length > 0 || outdoor.length > 0) && (wet || (grey && sunny.length > 0))) {
    const spans = [...sunny, ...outdoor].map((m) => [m.start, m.end] as [number, number]);
    // Quote a word ("terrasse", "sunshine") rather than an emoji when the post has one.
    const matches = [...sunny, ...outdoor].sort((a, b) => a.start - b.start);
    const quoted = (matches.find((m) => /\p{L}/u.test(m.text)) ?? matches[0])?.text;
    const rain = rainNote(w);
    const nextFair = (w as { nextFair?: string | null }).nextFair ?? null;
    const local = nextFair ? localParts(nextFair, post.timezone) : null;
    return [
      {
        detector: "weather",
        code: "weather_contradiction",
        verdict: "review",
        title: "The forecast says otherwise",
        detail: `"${quoted}" goes out into ${describeWeather(w.weatherCode)}${rain ? ` (${rain})` : ""}.`,
        evidence,
        spans,
        ...(nextFair && local
          ? {
              fix: {
                kind: "reschedule" as const,
                summary: `Move it to ${formatLocalDate(local.date)}, ${String(local.hour).padStart(2, "0")}:00, the next dry and bright slot`,
                dueAt: nextFair,
              },
            }
          : {}),
      },
    ];
  }
  if (snow.length > 0 && (w.snowfallCm ?? 0) === 0 && (w.temperatureC ?? 0) > 3) {
    return [
      {
        detector: "weather",
        code: "weather_contradiction",
        verdict: "review",
        title: "The forecast says otherwise",
        detail: `"${snow[0]?.text}" goes out at ${w.temperatureC} °C with no snow forecast.`,
        evidence,
        spans: snow.map((m) => [m.start, m.end] as [number, number]),
      },
    ];
  }
  return [];
}
