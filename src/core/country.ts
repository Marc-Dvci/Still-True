// Default audience country for a channel or account, from its IANA timezone (zone -> country table
// taken from the IANA tz database). The owner can change it in settings.
import table from "../../data/timezone-countries.json";

const zones = (table as { zones: Record<string, string> }).zones;

export function countryForTimeZone(timeZone: string): string | null {
  return zones[timeZone] ?? null;
}
