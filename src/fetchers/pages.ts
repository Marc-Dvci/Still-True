// Fetches a linked page and returns the facts the detectors compare with the post. Guarded: http(s)
// only, public hostnames only, 8-second timeout, 1.5 MB read cap, redirects followed and reported.
import { mergeShopify, parsePage, productFromShopifyJs, shopifyProductJsUrl } from "../core/page-parse";
import type { PageFacts } from "../core/types";
import { renderDemoPage } from "../demo/pages";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;
const USER_AGENT =
  "StillTrue/1.0 (+https://still-true.chatisthisreal.workers.dev/about; checks links in scheduled posts)";

export function isFetchable(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /\.(localhost|internal|local)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return host.includes(".");
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, merged.length - offset));
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= merged.length) break;
  }
  return new TextDecoder().decode(merged);
}

export interface PageFetchOptions {
  /** This deployment's own origin: links to its demo pages are rendered in-process. */
  origin: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function pageFactsFor(url: string, options: PageFetchOptions): Promise<PageFacts> {
  const now = options.now ?? Date.now;
  const fetchedAt = new Date(now()).toISOString();
  if (options.origin && url.startsWith(`${options.origin}/demo/`)) {
    const demo = renderDemoPage(new URL(url).pathname, now());
    if (!demo) return { status: 404, finalUrl: url, fetchedAt };
    const parsed = parsePage(demo.html);
    return {
      status: 200,
      finalUrl: url,
      title: parsed.title,
      product: parsed.product,
      event: parsed.event,
      fetchedAt,
    };
  }
  if (!isFetchable(url)) return { status: 0, finalUrl: url, fetchedAt };
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // A network failure or timeout is unknown, never "dead".
    return { status: 0, finalUrl: url, fetchedAt };
  }
  const finalUrl = response.url || url;
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, finalUrl, fetchedAt };
  }
  const type = response.headers.get("content-type") ?? "";
  if (type && !/html|xml|json/i.test(type)) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, finalUrl, fetchedAt };
  }
  const html = await readCapped(response);
  const parsed = parsePage(html);
  let product = parsed.product;
  const jsUrl = parsed.shopify ? shopifyProductJsUrl(finalUrl) : null;
  if (jsUrl) {
    try {
      const js = await fetchImpl(jsUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (js.ok) product = mergeShopify(product, productFromShopifyJs(await js.json()));
    } catch {
      // The JSON-LD facts stand when the endpoint is unavailable.
    }
  }
  return { status: response.status, finalUrl, title: parsed.title, product, event: parsed.event, fetchedAt };
}
