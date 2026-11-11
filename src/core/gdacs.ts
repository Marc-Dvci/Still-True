// GDACS (Global Disaster Alert and Coordination System) event list, GeoJSON -> DisasterEvent[].
// Feature properties used: eventtype, alertlevel, affectedcountries[].iso2, name, fromdate, todate, url.report.
import type { DisasterEvent, HazardType } from "./types";

const HAZARDS = new Set<HazardType>(["EQ", "TC", "FL", "VO", "DR", "WF"]);

interface GdacsFeature {
  properties?: {
    eventtype?: string;
    eventid?: number;
    alertlevel?: string;
    name?: string;
    country?: string;
    iso3?: string;
    fromdate?: string;
    todate?: string;
    affectedcountries?: { iso2?: string; iso3?: string; countryname?: string }[];
    url?: { report?: string };
  };
}

/** GDACS dates have no zone and are UTC. */
export function gdacsDate(value: string | undefined): string | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function parseGdacs(json: unknown): DisasterEvent[] {
  const features = (json as { features?: GdacsFeature[] } | null)?.features ?? [];
  const events: DisasterEvent[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const p = feature.properties;
    if (!p?.eventtype || !HAZARDS.has(p.eventtype as HazardType)) continue;
    const alert = (p.alertlevel ?? "").toLowerCase();
    if (alert !== "red" && alert !== "orange" && alert !== "green") continue;
    const from = gdacsDate(p.fromdate);
    if (!from) continue;
    const countries = [...new Set((p.affectedcountries ?? []).map((c) => c.iso2?.toUpperCase()).filter((c): c is string => !!c && c.length === 2))];
    const key = `${p.eventtype}:${p.eventid ?? p.name}:${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      type: p.eventtype as HazardType,
      alert,
      countries,
      name: p.name ?? `${p.eventtype} event`,
      from,
      to: gdacsDate(p.todate),
      url: p.url?.report ?? null,
    });
  }
  return events;
}
