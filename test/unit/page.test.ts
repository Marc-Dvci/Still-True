import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageFindings, pricesInText } from "../../src/core/detectors/page";
import {
  combineAvailability,
  extractJsonLd,
  metaAvailability,
  parsePage,
  parsePrice,
  productFromShopifyJs,
  shopifyProductJsUrl,
} from "../../src/core/page-parse";
import type { PageFacts } from "../../src/core/types";
import { codes, ctx, post } from "./helpers";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/pages/${name}`, import.meta.url), "utf8");

describe("reading real page markup", () => {
  it.each([
    ["woocommerce-product-instock.html", [48], "EUR", "InStock"],
    ["woocommerce-product-outofstock.html", [36], "EUR", "OutOfStock"],
    ["wix-product.html", [34], "EUR", "InStock"],
    ["shopify-product-instock.html", [49], "EUR", "InStock"],
    ["shopify-product-soldout.html", [39], "EUR", "OutOfStock"],
    ["shopify-product-variants.html", [24, 32], "EUR", "InStock"],
  ])("%s gives prices %j in %s, %s", (file, prices, currency, availability) => {
    const page = parsePage(fixture(file));
    expect(page.product?.prices).toEqual(prices);
    expect(page.product?.currency).toBe(currency);
    expect(page.product?.availability).toBe(availability);
  });

  it.each([
    ["event-scheduled.html", "EventScheduled"],
    ["event-cancelled.html", "EventCancelled"],
    ["event-postponed-eventstatus.html", "EventPostponed"],
    ["event-rescheduled.html", "EventRescheduled"],
    ["event-venue.html", "EventScheduled"],
  ])("%s gives status %s", (file, status) => {
    expect(parsePage(fixture(file)).event?.status).toBe(status);
  });

  it("reads 'Postponed' in an event title as postponed when eventStatus was left at EventScheduled", () => {
    expect(parsePage(fixture("event-postponed.html")).event?.status).toBe("EventPostponed");
  });

  it("keeps the new start date and the previous one of a rescheduled event", () => {
    const event = parsePage(fixture("event-rescheduled.html")).event;
    expect(event?.startDate).toBe("2027-03-06T20:00:00+01:00");
    expect(event?.previousStartDate).toBe("2027-02-27T20:00:00+01:00");
  });

  it("recognises a Shopify page", () => {
    expect(parsePage(fixture("shopify-product-instock.html")).shopify).toBe(true);
    expect(parsePage(fixture("woocommerce-product-instock.html")).shopify).toBe(false);
  });

  it("finds no product on a plain page or a shop's home page", () => {
    expect(parsePage(fixture("no-structured-data.html")).product).toBeNull();
    expect(parsePage(fixture("soft-404.html")).product).toBeNull();
  });

  it("repairs a JSON-LD block with trailing commas", () => {
    const html = fixture("malformed-jsonld.html");
    expect(extractJsonLd(html).length).toBe(2);
    expect(parsePage(html).product?.prices.length).toBeGreaterThan(0);
  });

  it("reads Shopify's product endpoint: cents and per-variant stock", () => {
    const json = (name: string) => JSON.parse(fixture(name)) as unknown;
    expect(productFromShopifyJs(json("shopify-product-instock.js.json"))).toMatchObject({
      prices: [49],
      availability: "InStock",
    });
    expect(productFromShopifyJs(json("shopify-product-soldout.js.json"))).toMatchObject({
      prices: [39],
      availability: "OutOfStock",
    });
    expect(productFromShopifyJs(json("shopify-product-variants.js.json"))).toMatchObject({
      prices: [24, 32],
      availability: "InStock",
    });
    expect(productFromShopifyJs({ title: "x" })).toBeNull();
    expect(productFromShopifyJs(null)).toBeNull();
  });

  it("builds the Shopify endpoint URL from a product URL", () => {
    expect(shopifyProductJsUrl("https://shop.example/products/linen-shirt?variant=1")).toBe(
      "https://shop.example/products/linen-shirt.js",
    );
    expect(shopifyProductJsUrl("https://shop.example/collections/all")).toBeNull();
    expect(shopifyProductJsUrl("not a url")).toBeNull();
  });
});

describe("prices, availability and units", () => {
  it.each([
    ["59.00", 59],
    ["59,00", 59],
    ["1.299,00", 1299],
    ["1,299.00", 1299],
    [59, 59],
    ["", null],
    [{}, null],
  ])("parsePrice(%j) is %j", (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it("is available when any offer is available", () => {
    expect(combineAvailability(["OutOfStock", "InStock"])).toBe("InStock");
    expect(combineAvailability(["OutOfStock", "SoldOut"])).toBe("OutOfStock");
    expect(combineAvailability([])).toBeNull();
  });

  it.each([
    ["instock", "InStock"],
    ["in stock", "InStock"],
    ["oos", "OutOfStock"],
    ["out of stock", "OutOfStock"],
    ["preorder", "PreOrder"],
    ["discontinued", "Discontinued"],
  ])("meta availability %s is %s", (raw, expected) => {
    expect(metaAvailability(raw)).toBe(expected);
  });

  it("reads prices written in the post, and not percentages or prices inside links", () => {
    expect(pricesInText("€49, or 49 € or $12.99 or 22 EUR").map((p) => p.value)).toEqual([49, 49, 12.99, 22]);
    expect(pricesInText("-15 % on everything")).toEqual([]);
    expect(pricesInText("https://shop.example/products/49-euro-gift")).toEqual([]);
  });
});

const LINK = "https://atelier-nord.example/products/linen-shirt";
const check = (text: string, page: PageFacts) =>
  pageFindings(post(text, "2026-11-13T10:00:00+01:00", { links: [LINK] }), ctx({ pages: { [LINK]: page } }));

describe("page checks", () => {
  it("holds a post whose link answers 404 or 410, and on a confirmed 5xx", () => {
    expect(codes(check(`New menu ${LINK}`, { status: 404 }))).toEqual(["link_dead"]);
    expect(codes(check(`New menu ${LINK}`, { status: 410 }))).toEqual(["link_dead"]);
    expect(codes(check(`New menu ${LINK}`, { status: 503 }))).toEqual(["link_dead"]);
  });

  it("says nothing when the page could not be reached at all", () => {
    expect(check(`New menu ${LINK}`, { status: 0 })).toEqual([]);
  });

  it("flags a deep link that now lands on the home page", () => {
    expect(
      codes(check(`New menu ${LINK}`, { status: 200, finalUrl: "https://atelier-nord.example/" })),
    ).toEqual(["link_redirect_home"]);
  });

  it("holds a post for a product that is out of stock, unless the post says so itself", () => {
    const page = { status: 200, product: { prices: [49], availability: "OutOfStock" } };
    expect(codes(check(`Back in stock! ${LINK}`, page))).toEqual(["out_of_stock"]);
    expect(check(`Sold out already, thank you! ${LINK}`, page)).toEqual([]);
  });

  it("flags a price the page no longer shows, and proposes the page's price in the post's format", () => {
    const [f] = check(`Linen shirt, 49,00 € ${LINK}`, {
      status: 200,
      product: { prices: [59], currency: "EUR", availability: "InStock" },
    });
    expect(f?.code).toBe("price_changed");
    expect(f?.fix?.text).toBe(`Linen shirt, 59,00 € ${LINK}`);
  });

  it("accepts a price that matches any variant", () => {
    expect(
      check(`Mugs from €24 ${LINK}`, { status: 200, product: { prices: [24, 32], availability: "InStock" } }),
    ).toEqual([]);
  });

  it("holds a post for a cancelled or postponed event", () => {
    expect(codes(check(`Quiz night ${LINK}`, { status: 200, event: { status: "EventCancelled" } }))).toEqual([
      "event_cancelled",
    ]);
    expect(codes(check(`Quiz night ${LINK}`, { status: 200, event: { status: "EventPostponed" } }))).toEqual([
      "event_postponed",
    ]);
  });

  it("flags an event whose date moved, and proposes the new date", () => {
    const [f] = check(`Ciné-club : vendredi 4 décembre à 20h30 ${LINK}`, {
      status: 200,
      event: { startDate: "2026-12-05T20:30:00+01:00", status: "EventScheduled" },
    });
    expect(f?.code).toBe("event_date_changed");
    expect(f?.fix?.text).toBe(`Ciné-club : samedi 5 décembre à 20h30 ${LINK}`);
  });

  it("flags a rescheduled event even when the post gives no date", () => {
    expect(
      codes(
        check(`Workshop tickets ${LINK}`, {
          status: 200,
          event: { startDate: "2026-12-05T14:00:00+01:00", status: "EventRescheduled" },
        }),
      ),
    ).toEqual(["event_date_changed"]);
  });

  it("accepts an event on the date the post states", () => {
    expect(
      check(`Saturday 5 December, 2pm ${LINK}`, {
        status: 200,
        event: { startDate: "2026-12-05T14:00:00+01:00", status: "EventScheduled" },
      }),
    ).toEqual([]);
  });

  it("ignores links with no facts", () => {
    expect(pageFindings(post(`See ${LINK}`, "2026-11-13T10:00:00+01:00", { links: [LINK] }), ctx())).toEqual(
      [],
    );
  });
});
