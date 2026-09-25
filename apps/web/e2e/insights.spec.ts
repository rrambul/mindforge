import { expect, test, type Page } from "@playwright/test";

/**
 * The year grid on Insights (FR-Q1), in a real browser.
 *
 * jsdom computes no styles, so whether a day with focus time is actually drawn
 * differently from a rest day is only visible here. It once was not: the only rule
 * that filled an active day was keyed on `data-measured`, the friction channel,
 * and the v0.2 refocus removed friction and the attribute with it. Every active day
 * then rendered in the rest-day grey, only more transparent.
 */

const DEV = { email: "dev@mindforge.local", password: "mindforge-dev" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(DEV.email);
  await page.getByLabel("Password").fill(DEV.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("a day with focus time is filled, and a rest day is not", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Insights" }).click();

  const grid = page.locator(".mf-heatmap");
  // "…: 45 min focused." against "…: nothing focused.", the labels the cells carry.
  const active = grid.getByRole("img", { name: /: \d.* focused\.$/u }).first();
  const rest = grid.getByRole("img", { name: /nothing focused\.$/u }).first();
  await expect(active).toBeAttached();
  await expect(rest).toBeAttached();

  const fill = (cell: typeof active) =>
    cell.evaluate((element) => getComputedStyle(element).backgroundColor);
  const activeFill = await fill(active);
  const restFill = await fill(rest);

  expect(activeFill).not.toBe(restFill);
});
