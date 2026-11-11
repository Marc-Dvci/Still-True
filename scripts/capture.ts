// Captures the README screenshots (2x) and a recording for the README GIF from a running deployment.
//   npx tsx scripts/capture.ts [base-url]
// Writes docs/screens/*.png and .scratch/recordings/*.webm (the GIF is cut from the recording with
// scripts/make_gif.py).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "https://still-true.chatisthisreal.workers.dev";
const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, "docs/screens"), { recursive: true });
mkdirSync(resolve(root, ".scratch/recordings"), { recursive: true });

const browser = await chromium.launch();

// Stills at 2x.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.locator("#hero-board").screenshot({ path: resolve(root, "docs/screens/board-los-angeles.png") });

  await page.goto(`${base}/drill#paris-2026-11-13`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  {
    const row = page.locator("#result .row").filter({ hasText: "Vendredi 13" });
    await row.getByRole("button").click();
    await page.waitForTimeout(400);
    await row.screenshot({ path: resolve(root, "docs/screens/finding-remembrance.png") });
  }
  await page.goto(`${base}/drill#los-angeles-2025-01-08`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  {
    const row = page.locator("#result .row").filter({ hasText: "linen shirt" });
    await row.getByRole("button").click();
    await page.waitForTimeout(400);
    await row.screenshot({ path: resolve(root, "docs/screens/finding-out-of-stock.png") });
  }
  await page.goto(`${base}/drill#strasbourg-2025-06-15`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  {
    const row = page.locator("#result .row").filter({ hasText: "terrasse" });
    await row.getByRole("button").click();
    await page.waitForTimeout(400);
    await row.screenshot({ path: resolve(root, "docs/screens/finding-weather.png") });
  }
  await page.close();
}

// A recording: the board settles, then a held post opens on its evidence.
{
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    recordVideo: { dir: resolve(root, ".scratch/recordings"), size: { width: 1180, height: 820 } },
  });
  const page = await context.newPage();
  await page.goto(`${base}/drill#los-angeles-2025-01-08`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelector("#result")?.scrollIntoView());
  await page.waitForTimeout(500);
  await page.locator("#scenarios button").filter({ hasText: "Los Angeles" }).click();
  await page.waitForTimeout(2600);
  await page.locator("#result .row").filter({ hasText: "on fire" }).getByRole("button").click();
  await page.waitForTimeout(3500);
  await context.close();
  console.log("recording saved");
}

await browser.close();
console.log("captured");
