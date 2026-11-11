import { describe, expect, it } from "vitest";
import { parseGdacs } from "../../src/core/gdacs";
import { weatherAt, nextFairHour } from "../../src/core/openmeteo";
import {
  decodeEntities,
  eventFromJsonLd,
  extractJsonLd,
  flattenNodes,
  mergeShopify,
  parsePage,
  productFromMeta,
} from "../../src/core/page-parse";

const feature = (props: Record<string, unknown>) => ({
  properties: {
    eventtype: "FL",
    eventid: 1,
    alertlevel: "Orange",
    name: "Flood",
    fromdate: "2025-01-01T00:00:00",
    ...props,
  },
});

describe("GDACS edge cases", () => {
  it("keeps green alerts, drops duplicates and unknown levels, and tolerates missing countries", () => {
    const events = parseGdacs({
      features: [
        feature({ alertlevel: "Green" }),
        feature({ alertlevel: "Green" }),
        feature({ eventid: 2, alertlevel: "Yellow" }),
        feature({ eventid: 3, affectedcountries: [{ iso3: "FRA" }, { iso2: "fr" }] }),
        feature({ eventid: 4, fromdate: undefined }),
        { properties: undefined },
      ],
    });
    expect(events.map((e) => [e.alert, e.countries])).toEqual([
      ["green", []],
      ["orange", ["FR"]],
    ]);
  });
});

describe("structured data edge cases", () => {
  it("reads CDATA-wrapped and HTML-escaped JSON-LD", () => {
    const cdata =
      '<script type="application/ld+json"><![CDATA[{"@type":"Product","offers":{"price":"10"}}]]></script>';
    const escaped =
      '<script type="application/ld+json">{&quot;@type&quot;:&quot;Product&quot;,&quot;offers&quot;:{&quot;price&quot;:&quot;12&quot;}}</script>';
    expect(parsePage(cdata).product?.prices).toEqual([10]);
    expect(parsePage(escaped).product?.prices).toEqual([12]);
    expect(extractJsonLd('<script type="application/ld+json">   </script>')).toEqual([]);
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("Caf&#233; &amp; Th&#xE9; &lt;3")).toBe("Café & Thé <3");
  });

  it("reads nested offers, price specifications and currencies", () => {
    const nodes = flattenNodes([
      {
        "@type": ["Product", "Thing"],
        name: "Mug &amp; saucer",
        offers: {
          "@type": "AggregateOffer",
          lowPrice: "18,50",
          offers: [
            {
              priceSpecification: [{ price: "20.00", priceCurrency: "EUR" }],
              availability: "schema:SoldOut",
            },
          ],
        },
      },
    ]);
    const page = parsePage(`<script type="application/ld+json">${JSON.stringify(nodes[0])}</script>`);
    expect(page.product).toMatchObject({
      prices: [18.5, 20],
      currency: "EUR",
      availability: "SoldOut",
      name: "Mug & saucer",
    });
  });

  it("reads Open Graph product tags and merges them with JSON-LD", () => {
    const meta =
      '<meta property="product:price:amount" content="29,90"><meta property="product:price:currency" content="EUR"><meta property="product:availability" content="out of stock">';
    expect(productFromMeta(meta)).toMatchObject({
      prices: [29.9],
      currency: "EUR",
      availability: "OutOfStock",
    });
    expect(productFromMeta("<meta property='og:title' content='x'>")).toBeNull();
    const merged = parsePage(
      `${meta}<script type="application/ld+json">{"@type":"Product","name":"x","offers":{}}</script>`,
    );
    expect(merged.product).toMatchObject({ prices: [29.9], currency: "EUR", availability: "OutOfStock" });
  });

  it("returns no event when there is none, and keeps the JSON-LD currency on Shopify data", () => {
    expect(eventFromJsonLd([{ "@type": "Organization" }])).toBeNull();
    expect(
      mergeShopify({ prices: [1], currency: "EUR" }, { prices: [2], availability: "InStock" }),
    ).toMatchObject({ prices: [2], currency: "EUR" });
    expect(mergeShopify(null, null)).toBeNull();
  });
});

describe("Open-Meteo edge cases", () => {
  it("answers null for empty responses", () => {
    expect(weatherAt({}, "2026-01-01T00:00:00Z")).toBeNull();
    expect(nextFairHour({}, "2026-01-01T00:00:00Z", "UTC")).toBeNull();
  });

  it("applies the response's UTC offset", () => {
    const response = { utc_offset_seconds: 3600, hourly: { time: ["2026-01-01T10:00"], weather_code: [0] } };
    expect(weatherAt(response, "2026-01-01T09:30:00Z")?.weatherCode).toBe(0);
    expect(weatherAt(response, "2026-01-01T10:30:00Z")).toBeNull();
  });
});
