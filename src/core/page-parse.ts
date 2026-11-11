// Reads the facts a post can contradict from a fetched page: a product's prices and availability, an
// event's date and status. Sources, in order of authority: Shopify's product JSON endpoint, schema.org
// JSON-LD, then Open Graph product meta tags. Pure functions over strings, so they are tested on
// recorded markup.
import type { EventFacts, ProductFacts } from "./types";

const EVENT_TYPES = new Set([
  "Event",
  "BusinessEvent",
  "ChildrensEvent",
  "ComedyEvent",
  "CourseInstance",
  "DanceEvent",
  "DeliveryEvent",
  "EducationEvent",
  "EventSeries",
  "ExhibitionEvent",
  "Festival",
  "FoodEvent",
  "Hackathon",
  "LiteraryEvent",
  "MusicEvent",
  "PublicationEvent",
  "SaleEvent",
  "ScreeningEvent",
  "SocialEvent",
  "SportsEvent",
  "TheaterEvent",
  "VisualArtsEvent",
]);
const PRODUCT_TYPES = new Set([
  "Product",
  "ProductGroup",
  "IndividualProduct",
  "ProductModel",
  "Vehicle",
  "Book",
]);

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#34;": '"',
  "&amp;": "&",
  "&#38;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&apos;": "'",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&(?:quot|amp|lt|gt|apos|#34|#38|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** Every parseable JSON-LD block. A malformed block is retried once with trailing commas removed. */
export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = (match[1] ?? "").trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    if (!raw) continue;
    for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, "$1"), decodeEntities(raw)]) {
      try {
        blocks.push(JSON.parse(candidate));
        break;
      } catch {
        // try the next repair
      }
    }
  }
  return blocks;
}

/** Flattens arrays and @graph containers into a list of JSON-LD nodes. */
export function flattenNodes(blocks: unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node["@graph"]) visit(node["@graph"], depth + 1);
    if (node["@type"]) nodes.push(node);
    if (Array.isArray(node.hasVariant)) visit(node.hasVariant, depth + 1);
  };
  for (const block of blocks) visit(block, 0);
  return nodes;
}

function types(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((t): t is string => typeof t === "string").map(shortName);
}

/** "https://schema.org/InStock", "http://schema.org/InStock", "schema:InStock" -> "InStock". */
export function shortName(value: string): string {
  return value
    .replace(/^https?:\/\/schema\.org\//i, "")
    .replace(/^schema:/i, "")
    .trim();
}

/** "59.00", "59,00", 59, "1.299,00", "1,299.00" -> number. */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

interface OfferSummary {
  prices: number[];
  currency: string | null;
  availability: string[];
}

function readOffers(offers: unknown): OfferSummary {
  const summary: OfferSummary = { prices: [], currency: null, availability: [] };
  for (const raw of asArray(offers)) {
    if (!raw || typeof raw !== "object") continue;
    const offer = raw as Record<string, unknown>;
    const nested = readOffers(offer.offers);
    summary.prices.push(...nested.prices);
    summary.availability.push(...nested.availability);
    summary.currency ??= nested.currency;
    for (const key of ["price", "lowPrice", "highPrice"]) {
      const price = parsePrice(offer[key]);
      if (price !== null) summary.prices.push(price);
    }
    for (const spec of asArray(offer.priceSpecification)) {
      if (spec && typeof spec === "object") {
        const price = parsePrice((spec as Record<string, unknown>).price);
        if (price !== null) summary.prices.push(price);
        const currency = (spec as Record<string, unknown>).priceCurrency;
        if (typeof currency === "string") summary.currency ??= currency;
      }
    }
    if (typeof offer.priceCurrency === "string") summary.currency ??= offer.priceCurrency;
    if (typeof offer.availability === "string") summary.availability.push(shortName(offer.availability));
  }
  return summary;
}

const AVAILABLE = new Set([
  "InStock",
  "InStoreOnly",
  "OnlineOnly",
  "LimitedAvailability",
  "PreOrder",
  "PreSale",
  "BackOrder",
  "MadeToOrder",
]);
const UNAVAILABLE = new Set(["OutOfStock", "SoldOut", "Discontinued"]);

/** A product is unavailable only when no offer is available. */
export function combineAvailability(values: string[]): string | null {
  if (values.length === 0) return null;
  if (values.some((v) => AVAILABLE.has(v))) return values.find((v) => AVAILABLE.has(v)) ?? "InStock";
  return values.find((v) => UNAVAILABLE.has(v)) ?? values[0] ?? null;
}

export function productFromJsonLd(nodes: Record<string, unknown>[]): ProductFacts | null {
  const products = nodes.filter((n) => types(n).some((t) => PRODUCT_TYPES.has(t)));
  if (products.length === 0) return null;
  const prices: number[] = [];
  const availability: string[] = [];
  let currency: string | null = null;
  let name: string | null = null;
  for (const product of products) {
    const offers = readOffers(product.offers);
    prices.push(...offers.prices);
    availability.push(...offers.availability);
    currency ??= offers.currency;
    if (typeof product.name === "string") name ??= decodeEntities(product.name);
  }
  return { prices: uniqueSorted(prices), currency, availability: combineAvailability(availability), name };
}

export function eventFromJsonLd(nodes: Record<string, unknown>[]): EventFacts | null {
  const event = nodes.find((n) => types(n).some((t) => EVENT_TYPES.has(t)));
  if (!event) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const name = str(event.name) ? decodeEntities(str(event.name) as string) : null;
  let status = str(event.eventStatus) ? shortName(str(event.eventStatus) as string) : null;
  // Some ticketing sites keep eventStatus at EventScheduled and announce the change in the title only
  // ("Postponed Further date will be announced", "CANCELLED - Pottery night").
  if ((status === null || status === "EventScheduled") && name) {
    if (/^\s*(?:cancel+ed|annul[ée]e?s?)\b/i.test(name)) status = "EventCancelled";
    else if (/^\s*(?:postponed|report[ée]e?s?)\b/i.test(name)) status = "EventPostponed";
  }
  return {
    startDate: str(event.startDate),
    previousStartDate: str(asArray(event.previousStartDate)[0]),
    status,
    name,
  };
}

/** Open Graph / Facebook product meta tags. */
export function productFromMeta(html: string): ProductFacts | null {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const text = tag[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(text)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(text)?.[1];
    if (key && content !== undefined && !meta.has(key)) meta.set(key, decodeEntities(content));
  }
  const amount = meta.get("product:price:amount") ?? meta.get("og:price:amount");
  const price = amount !== undefined ? parsePrice(amount) : null;
  const rawAvailability = meta.get("product:availability") ?? meta.get("og:availability");
  if (price === null && !rawAvailability) return null;
  return {
    prices: price === null ? [] : [price],
    currency: meta.get("product:price:currency") ?? meta.get("og:price:currency") ?? null,
    availability: rawAvailability ? metaAvailability(rawAvailability) : null,
    name: meta.get("og:title") ?? null,
  };
}

export function metaAvailability(value: string): string {
  const v = value.toLowerCase().replace(/[\s_-]/g, "");
  if (["instock", "available", "in", "preorder"].includes(v))
    return v === "preorder" ? "PreOrder" : "InStock";
  if (["outofstock", "oos", "soldout", "unavailable"].includes(v)) return "OutOfStock";
  if (v === "discontinued") return "Discontinued";
  return shortName(value);
}

/** Shopify's public product JSON (`/products/<handle>.js`): prices in minor units, `available` booleans. */
export function productFromShopifyJs(json: unknown): ProductFacts | null {
  if (!json || typeof json !== "object") return null;
  const product = json as { title?: unknown; variants?: unknown; price?: unknown; available?: unknown };
  const variants = Array.isArray(product.variants) ? (product.variants as Record<string, unknown>[]) : [];
  const cents = variants.map((v) => v.price).filter((p): p is number => typeof p === "number");
  if (cents.length === 0 && typeof product.price === "number") cents.push(product.price);
  if (cents.length === 0) return null;
  const anyAvailable = variants.length
    ? variants.some((v) => v.available === true)
    : product.available === true;
  return {
    prices: uniqueSorted(cents.map((c) => Math.round(c) / 100)),
    currency: null,
    availability: anyAvailable ? "InStock" : "OutOfStock",
    name: typeof product.title === "string" ? product.title : null,
  };
}

export function pageTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? decodeEntities(title.replace(/\s+/g, " ").trim()) : null;
}

export function looksLikeShopify(html: string): boolean {
  return /cdn\.shopify\.com|Shopify\.shop\s*=|shopify-digital-wallet|window\.ShopifyAnalytics/i.test(html);
}

export function shopifyProductJsUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    const match = /^(.*\/products\/[^/?#]+?)(?:\.js|\.json)?\/?$/.exec(url.pathname);
    if (!match?.[1]) return null;
    return `${url.origin}${match[1]}.js`;
  } catch {
    return null;
  }
}

export interface ParsedPage {
  title: string | null;
  product: ProductFacts | null;
  event: EventFacts | null;
  shopify: boolean;
}

export function parsePage(html: string): ParsedPage {
  const nodes = flattenNodes(extractJsonLd(html));
  const fromLd = productFromJsonLd(nodes);
  const fromMeta = productFromMeta(html);
  let product = fromLd;
  if (product && fromMeta) {
    product = {
      ...product,
      prices: product.prices.length ? product.prices : fromMeta.prices,
      currency: product.currency ?? fromMeta.currency ?? null,
      availability: product.availability ?? fromMeta.availability ?? null,
    };
  } else if (!product) {
    product = fromMeta;
  }
  return { title: pageTitle(html), product, event: eventFromJsonLd(nodes), shopify: looksLikeShopify(html) };
}

/** Shopify's endpoint knows exact variant prices and stock; JSON-LD keeps the currency. */
export function mergeShopify(page: ProductFacts | null, shopify: ProductFacts | null): ProductFacts | null {
  if (!shopify) return page;
  return {
    ...shopify,
    currency: page?.currency ?? shopify.currency ?? null,
    name: shopify.name ?? page?.name ?? null,
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
}
