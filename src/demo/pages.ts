// Atelier Nord and Salle Rivage: a demo shop and a demo venue, served at /demo/... so the sample drafts
// have real pages to link to. Each page carries schema.org JSON-LD exactly as shops and ticketing sites
// publish it, and Still True reads it with the same parser it uses for any other site.
// Dates are relative to "now" so the demo stays coherent on any day.
import { addDays, localParts, localToInstant } from "../core/time";

const TZ = "Europe/Paris";

export interface DemoPage {
  html: string;
  title: string;
}

interface ProductSpec {
  kind: "product";
  title: string;
  description: string;
  price: string;
  availability: "InStock" | "OutOfStock";
}

interface EventSpec {
  kind: "event";
  title: string;
  description: string;
  status: "EventScheduled" | "EventPostponed" | "EventCancelled" | "EventRescheduled";
  /** Days from today (Paris) and local hour. */
  inDays: number;
  hour: number;
  movedByDays?: number;
}

const PAGES: Record<string, ProductSpec | EventSpec> = {
  "/demo/shop/linen-shirt": {
    kind: "product",
    title: "Linen shirt, natural",
    description: "Washed linen, relaxed fit.",
    price: "49.00",
    availability: "OutOfStock",
  },
  "/demo/shop/wool-scarf": {
    kind: "product",
    title: "Wool scarf, rust",
    description: "Merino and alpaca, knitted in Alsace.",
    price: "59.00",
    availability: "InStock",
  },
  "/demo/shop/gift-card": {
    kind: "product",
    title: "Gift card",
    description: "Any amount, no expiry.",
    price: "25.00",
    availability: "InStock",
  },
  "/demo/events/jazz-night": {
    kind: "event",
    title: "Jazz night at Salle Rivage",
    description: "Trio set, doors at 19:30.",
    status: "EventPostponed",
    inDays: 3,
    hour: 20,
  },
  "/demo/events/ceramics-workshop": {
    kind: "event",
    title: "Ceramics workshop",
    description: "Two hours at the wheel, materials included.",
    status: "EventRescheduled",
    inDays: 2,
    hour: 14,
    movedByDays: 7,
  },
  "/demo/events/open-studio": {
    kind: "event",
    title: "Open studio",
    description: "Meet the makers, free entry.",
    status: "EventScheduled",
    inDays: 4,
    hour: 11,
  },
};

export const DEMO_PATHS = Object.keys(PAGES);

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function localIso(dateKey: string, hour: number): string {
  // ISO with the Paris offset, as ticketing sites publish startDate.
  const instant = localToInstant(dateKey, hour, 0, TZ);
  const parts = localParts(instant, TZ);
  const offsetMinutes = Math.round(
    (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant.getTime()) / 60_000,
  );
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${dateKey}T${String(hour).padStart(2, "0")}:00:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function demoEventDates(
  path: string,
  now: number,
): { startDate: string; previousStartDate?: string } | null {
  const spec = PAGES[path];
  if (!spec || spec.kind !== "event") return null;
  const today = localParts(now, TZ).date;
  const original = addDays(today, spec.inDays);
  if (spec.movedByDays) {
    return {
      startDate: localIso(addDays(original, spec.movedByDays), spec.hour),
      previousStartDate: localIso(original, spec.hour),
    };
  }
  return { startDate: localIso(original, spec.hour) };
}

export function renderDemoPage(path: string, now: number): DemoPage | null {
  const spec = PAGES[path.replace(/\/+$/, "")];
  if (!spec) return null;
  let jsonLd: Record<string, unknown>;
  let facts: string;
  if (spec.kind === "product") {
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: spec.title,
      description: spec.description,
      brand: { "@type": "Brand", name: "Atelier Nord" },
      offers: {
        "@type": "Offer",
        price: spec.price,
        priceCurrency: "EUR",
        availability: `https://schema.org/${spec.availability}`,
      },
    };
    facts = `<p class="price">€${spec.price}</p><p class="stock ${spec.availability === "InStock" ? "in" : "out"}">${spec.availability === "InStock" ? "In stock" : "Out of stock"}</p>`;
  } else {
    const dates = demoEventDates(path, now) as { startDate: string; previousStartDate?: string };
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      name: spec.title,
      description: spec.description,
      startDate: dates.startDate,
      ...(dates.previousStartDate ? { previousStartDate: dates.previousStartDate } : {}),
      eventStatus: `https://schema.org/${spec.status}`,
      location: { "@type": "Place", name: "Salle Rivage", address: "Strasbourg" },
    };
    const label = {
      EventScheduled: "On sale",
      EventPostponed: "Postponed, new date to come",
      EventCancelled: "Cancelled",
      EventRescheduled: "Moved to a new date",
    }[spec.status];
    facts = `<p class="date">${escapeHtml(new Date(dates.startDate).toLocaleString("en-GB", { timeZone: TZ, dateStyle: "full", timeStyle: "short" }))}</p><p class="stock ${spec.status === "EventScheduled" ? "in" : "out"}">${label}</p>`;
  }
  const brand = spec.kind === "product" ? "Atelier Nord" : "Salle Rivage";
  const title = `${spec.title} · ${brand}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(spec.title)}">
<meta name="robots" content="noindex">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#111;background:#fff}
.banner{border-left:3px solid #d7261e;padding:.5rem .75rem;margin-bottom:2rem;font-size:.9rem}
.price{font-size:1.6rem;margin:.25rem 0}.stock.out{color:#d7261e;font-weight:600}.stock.in{color:#14532d;font-weight:600}</style>
</head><body>
<p class="banner">${brand} is a demo ${spec.kind === "product" ? "shop" : "venue"} used by Still True's sample posts. Nothing here is for sale.</p>
<h1>${escapeHtml(spec.title)}</h1><p>${escapeHtml(spec.description)}</p>${facts}
<p><a href="/">Still True</a></p>
</body></html>`;
  return { html, title };
}
