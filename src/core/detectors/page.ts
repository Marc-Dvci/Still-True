// Page: the linked page is the source of truth for prices, stock and event dates.
import { findDates } from "../datetext";
import { has, maskUrls } from "../text";
import { formatLocalDate, localParts } from "../time";
import type { CheckContext, Evidence, Finding, PageFacts, PostUnderCheck } from "../types";

const CURRENCY = "€|\\$|£|EUR|USD|GBP|CAD|AUD|CHF|NZD|euros?|CA\\$|A\\$|US\\$";
const PRICE_PATTERN = new RegExp(
  `(?:(${CURRENCY})\\s?(\\d{1,5}(?:[.,]\\d{1,2})?))|(?:(\\d{1,5}(?:[.,]\\d{1,2})?)\\s?(${CURRENCY}))`,
  "gi",
);
const UNAVAILABLE = new Set(["OutOfStock", "SoldOut", "Discontinued"]);
const SOLD_OUT_WORDS = /\b(sold out|out of stock|back soon|epuise|rupture de stock|plus disponible|agotado)\b/;

export interface PriceRef {
  value: number;
  text: string;
  start: number;
  end: number;
  number: string;
  numberStart: number;
}

export function pricesInText(text: string): PriceRef[] {
  const out: PriceRef[] = [];
  for (const m of maskUrls(text).matchAll(PRICE_PATTERN)) {
    const raw = m[2] ?? m[3];
    if (!raw) continue;
    const start = m.index ?? 0;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const before = text.slice(Math.max(0, start - 1), start);
    if (before === "-" || before === "%") continue;
    out.push({ value, text: m[0], start, end: start + m[0].length, number: raw, numberStart: start + m[0].indexOf(raw) });
  }
  return out;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

function formatPrice(value: number, like: string): string {
  const decimals = /[.,]\d{2}$/.test(like) || !Number.isInteger(value) ? 2 : 0;
  const s = value.toFixed(decimals);
  return like.includes(",") ? s.replace(".", ",") : s;
}

function sourceEvidence(url: string, facts: PageFacts): Evidence {
  return { label: "Read from", value: host(url) + pathOf(url), source: url, readAt: facts.fetchedAt ?? null };
}

/** The event's own calendar date, taken from its ISO startDate as published (its local date). */
function eventDateKey(startDate: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(startDate);
  return m?.[1] ?? null;
}

export function pageFindings(post: PostUnderCheck, ctx: CheckContext): Finding[] {
  const findings: Finding[] = [];
  const due = localParts(post.dueAt, post.timezone);
  for (const url of post.links) {
    const facts = ctx.pages[url];
    if (!facts) continue;
    const linkStart = post.text.indexOf(url.replace(/\/$/, ""));
    const linkSpan: [number, number][] = linkStart >= 0 ? [[linkStart, linkStart + url.length]] : [];
    const from = sourceEvidence(url, facts);

    if (facts.status === 404 || facts.status === 410 || facts.status >= 500) {
      findings.push({
        detector: "page",
        code: "link_dead",
        verdict: "hold",
        title: "Link is broken",
        detail: `${host(url)}${pathOf(url)} answers HTTP ${facts.status}.`,
        evidence: [{ label: "HTTP status", value: String(facts.status) }, from],
        spans: linkSpan,
      });
      continue;
    }
    if (facts.status < 200 || facts.status >= 400) continue;

    if (facts.finalUrl && pathOf(url) !== "/" && pathOf(facts.finalUrl) === "/" ) {
      findings.push({
        detector: "page",
        code: "link_redirect_home",
        verdict: "review",
        title: "Link now lands on the home page",
        detail: `${host(url)}${pathOf(url)} redirects to ${host(facts.finalUrl)}/.`,
        evidence: [{ label: "Lands on", value: facts.finalUrl }, from],
        spans: linkSpan,
      });
    }

    const product = facts.product;
    if (product) {
      if (product.availability && UNAVAILABLE.has(product.availability) && !has(post.text, SOLD_OUT_WORDS)) {
        findings.push({
          detector: "page",
          code: "out_of_stock",
          verdict: "hold",
          title: "Product is out of stock",
          detail: `${product.name ? `"${product.name}"` : "The linked product"} is marked ${product.availability} on the page.`,
          evidence: [{ label: "Availability", value: product.availability }, from],
          spans: linkSpan,
        });
      }
      const stated = pricesInText(post.text);
      if (stated.length > 0 && product.prices.length > 0) {
        const matches = stated.some((p) => product.prices.some((q) => Math.abs(q - p.value) < 0.005));
        if (!matches) {
          const first = stated[0] as PriceRef;
          const nearest = product.prices.reduce((a, b) => (Math.abs(b - first.value) < Math.abs(a - first.value) ? b : a));
          const replacement = formatPrice(nearest, first.number);
          const fixed = `${post.text.slice(0, first.numberStart)}${replacement}${post.text.slice(first.numberStart + first.number.length)}`;
          findings.push({
            detector: "page",
            code: "price_changed",
            verdict: "review",
            title: "Price changed",
            detail: `The post says ${first.text.trim()}; the page now says ${product.prices.map((p) => formatPrice(p, first.number)).join(" / ")}${product.currency ? ` ${product.currency}` : ""}.`,
            evidence: [
              { label: "Post says", value: first.text.trim() },
              { label: "Page says", value: product.prices.join(", ") + (product.currency ? ` ${product.currency}` : "") },
              from,
            ],
            spans: stated.map((p) => [p.start, p.end] as [number, number]),
            fix: { kind: "replace_text", summary: `Change ${first.text.trim()} to ${replacement}`, text: fixed },
          });
        }
      }
    }

    const event = facts.event;
    if (event) {
      const status = event.status ?? "EventScheduled";
      if (status === "EventCancelled" || status === "EventPostponed") {
        const cancelled = status === "EventCancelled";
        findings.push({
          detector: "page",
          code: cancelled ? "event_cancelled" : "event_postponed",
          verdict: "hold",
          title: cancelled ? "Event cancelled" : "Event postponed",
          detail: `${event.name ? `"${event.name}"` : "The linked event"} is marked ${status} on the page.`,
          evidence: [{ label: "Event status", value: status }, from],
          spans: linkSpan,
        });
        continue;
      }
      const startKey = event.startDate ? eventDateKey(event.startDate) : null;
      if (startKey) {
        const stated = findDates(post.text, due.date, ctx.country);
        const differs = stated.length > 0 && !stated.some((d) => d.key === startKey);
        const rescheduledSilently = status === "EventRescheduled" && stated.length === 0;
        if (differs || rescheduledSilently) {
          const first = stated[0];
          let fix: Finding["fix"];
          if (first) {
            const lang = first.lang;
            const formatted = formatLocalDate(startKey, lang);
            const replacement = first.weekday ? formatted : formatted.split(" ").slice(1).join(" ");
            fix = {
              kind: "replace_text",
              summary: `Change "${first.text}" to "${replacement}"`,
              text: `${post.text.slice(0, first.start)}${replacement}${post.text.slice(first.end)}`,
            };
          }
          findings.push({
            detector: "page",
            code: "event_date_changed",
            verdict: "review",
            title: "Event date changed",
            detail: `The page now gives ${formatLocalDate(startKey)}${first ? `; the post says "${first.text}"` : ""}.`,
            evidence: [{ label: "Event starts", value: event.startDate as string }, { label: "Event status", value: status }, from],
            spans: first ? [[first.start, first.end]] : linkSpan,
            ...(fix ? { fix } : {}),
          });
        }
      }
    }
  }
  return findings;
}
