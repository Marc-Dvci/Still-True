// Renders the committed figures from their HTML sources with Playwright (Chromium):
//   docs/architecture.html -> docs/architecture.png (2x)
//   docs/og-card.html      -> web/public/og-card.png (1200x630) and docs/social-preview.png (1280x640)
// Run: npx tsx scripts/render_figures.ts
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const browser = await chromium.launch();

async function render(source: string, out: string, scale: number, vars?: { w: number; h: number }) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1400, height: 1200 } });
  await page.goto(pathToFileURL(resolve(root, source)).href);
  if (vars) {
    await page.evaluate(([w, h]) => {
      const el = document.querySelector<HTMLElement>("#card");
      el?.style.setProperty("--w", `${w}px`);
      el?.style.setProperty("--h", `${h}px`);
    }, [vars.w, vars.h]);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.locator(vars ? "#card" : "#figure").screenshot({ path: resolve(root, out) });
  await page.close();
  console.log(out);
}

await render("docs/architecture.html", "docs/architecture.png", 2);
await render("docs/og-card.html", "web/public/og-card.png", 1, { w: 1200, h: 630 });
await render("docs/og-card.html", "docs/social-preview.png", 1, { w: 1280, h: 640 });
await browser.close();
