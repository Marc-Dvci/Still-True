// National remembrance and mourning days (data/remembrance.json: every entry carries its source).
import data from "../../data/remembrance.json";
import type { RemembranceDay } from "./types";

interface Entry {
  id: string;
  countries: string[];
  name: string;
  localName?: string;
  severity: "high" | "moderate";
  dates: string[];
  source?: string;
}

export function remembranceDays(): RemembranceDay[] {
  return (data as { entries: Entry[] }).entries.map((e) => ({
    id: e.id,
    countries: e.countries,
    name: e.name,
    localName: e.localName ?? null,
    severity: e.severity,
    dates: e.dates,
    source: e.source ?? null,
  }));
}
