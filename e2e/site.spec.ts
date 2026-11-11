import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function noSeriousA11yIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
}

test("the landing page replays a real day on the departure board", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The last look");
  const rows = page.locator("#hero-board .row");
  await expect(rows).toHaveCount(8);
  await expect(page.locator("#hero-board .flap.hold").first()).toHaveText("Held", { timeout: 5_000 });
  await expect(page.locator("#hero-source")).toContainText("2 held, 3 for review, 3 still true");
  await rows.nth(1).getByRole("button").click();
  await expect(rows.nth(1).locator(".finding").first()).toContainText("Wording echoes an active wildfire");
  expect(errors).toEqual([]);
  await noSeriousA11yIssues(page);
});

test("the fire drill replays each scenario", async ({ page }) => {
  await page.goto("/drill");
  const scenarios = page.locator("#scenarios button");
  await expect(scenarios).toHaveCount(5);
  await scenarios.filter({ hasText: "Valencia" }).click();
  await expect(page.locator("#result h3")).toHaveText("3 held · 3 for review · 2 still true");
  await scenarios.filter({ hasText: "Paris" }).click();
  await expect(page.locator("#result h3")).toHaveText("1 held · 3 for review · 4 still true");
  await page.locator("#result .row").filter({ hasText: "Vendredi 13" }).getByRole("button").click();
  await expect(page.locator("#result .row.open .finding")).toContainText("Promotion on a day of remembrance");
  await noSeriousA11yIssues(page);
});

test("the board sends a signed-out visitor to connect Buffer", async ({ page }) => {
  await page.goto("/board");
  await expect(page).toHaveURL(/\/\?error=/);
  await expect(page.locator("#error")).toContainText("Connect your Buffer account");
});

test("the demo shop page shows what the structured data says", async ({ page }) => {
  await page.goto("/demo/shop/linen-shirt");
  await expect(page.locator(".stock")).toHaveText("Out of stock");
});

for (const path of ["/about", "/privacy"]) {
  test(`${path} reads cleanly`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noSeriousA11yIssues(page);
  });
}
