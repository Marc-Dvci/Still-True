// The decision core's vocabulary. Everything under src/core is pure and deterministic: it takes a post
// and the facts read about the world, and returns findings. No network, no clock, no model.

export type Verdict = "still_true" | "review" | "hold";

export type DetectorId = "calendar" | "page" | "weather" | "remembrance" | "world";

export type FindingCode =
  | "weekday_date_mismatch"
  | "relative_anchor_conflict"
  | "due_moved_relative_word"
  | "time_already_passed"
  | "date_already_passed"
  | "daypart_mismatch"
  | "link_dead"
  | "link_redirect_home"
  | "out_of_stock"
  | "price_changed"
  | "event_cancelled"
  | "event_postponed"
  | "event_date_changed"
  | "weather_contradiction"
  | "remembrance_day_tone"
  | "disaster_wording_collision"
  | "disaster_promo_window"
  | "major_news_window";

/** A scheduled post as the detectors see it. Times are ISO 8601 instants. */
export interface PostUnderCheck {
  id?: string;
  text: string;
  createdAt: string;
  dueAt: string;
  /** The due time Still True saw the first time it read this post (null on first sight). */
  firstSeenDueAt?: string | null;
  service: string;
  /** IANA timezone of the channel, e.g. Europe/Paris. Local days and hours are read in it. */
  timezone: string;
  links: string[];
}

export interface ProductFacts {
  prices: number[];
  currency?: string | null;
  /** schema.org availability, short form: InStock, OutOfStock, SoldOut, Discontinued, PreOrder... */
  availability?: string | null;
  name?: string | null;
}

export interface EventFacts {
  startDate?: string | null;
  previousStartDate?: string | null;
  /** schema.org eventStatus, short form: EventScheduled, EventCancelled, EventPostponed, EventRescheduled. */
  status?: string | null;
  name?: string | null;
}

export interface PageFacts {
  status: number;
  finalUrl?: string | null;
  title?: string | null;
  product?: ProductFacts | null;
  event?: EventFacts | null;
  fetchedAt?: string | null;
}

/** The forecast (or observation) for the hour the post is due. */
export interface WeatherAtDue {
  precipProbability: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  temperatureC: number | null;
  cloudCover: number | null;
  snowfallCm: number | null;
  time?: string | null;
  /** The next dry, bright daytime hour in the forecast, used to propose a new slot. */
  nextFair?: string | null;
}

export type HazardType = "EQ" | "TC" | "FL" | "VO" | "DR" | "WF";

export interface DisasterEvent {
  type: HazardType;
  alert: "red" | "orange" | "green";
  /** ISO 3166-1 alpha-2 codes of the affected countries. */
  countries: string[];
  name: string;
  from: string;
  to?: string | null;
  url?: string | null;
}

export interface NewsItem {
  date: string;
  category: "attacks" | "disasters" | "other";
  countries: string[];
  headline: string;
  url?: string | null;
}

export interface RemembranceDay {
  id: string;
  countries: string[];
  name: string;
  localName?: string | null;
  severity: "high" | "moderate";
  /** YYYY-MM-DD local dates. */
  dates: string[];
  source?: string | null;
}

export interface CheckContext {
  /** ISO 3166-1 alpha-2 code of the audience's country. */
  country: string;
  pages: Record<string, PageFacts>;
  weather: WeatherAtDue | null;
  gdacs: DisasterEvent[];
  news: NewsItem[];
  remembrance: RemembranceDay[];
}

export interface Evidence {
  label: string;
  value: string;
  source?: string | null;
  readAt?: string | null;
}

export interface Fix {
  kind: "replace_text" | "reschedule";
  summary: string;
  text?: string;
  dueAt?: string;
}

export interface Finding {
  detector: DetectorId;
  code: FindingCode;
  verdict: Exclude<Verdict, "still_true">;
  title: string;
  detail: string;
  evidence: Evidence[];
  /** Character ranges of the post text the finding is about, for highlighting. */
  spans: [number, number][];
  fix?: Fix;
}

export interface CheckResult {
  verdict: Verdict;
  findings: Finding[];
}

export const VERDICT_RANK: Record<Verdict, number> = { still_true: 0, review: 1, hold: 2 };
