import { expect, test, type Page } from "@playwright/test";

/**
 * A mission card → its curriculum (§13.2, M4's FR-K5).
 *
 * The same gap `teach.spec.ts` exists for, one screen over: the link is composed
 * in `app/MissionsScreen`, the screen in `app/CurriculumScreen`, the route in
 * `app/router.tsx`, and the panel in `features/curriculum` — four files with
 * nothing joining them but the route table. Every unit test passes with the link
 * unthreaded, and this is where that shows up.
 *
 * It stops at a mission with no curriculum yet, which is where a fresh mission
 * genuinely is. What used to be asserted here was that the empty state named a
 * terminal command rather than a button, because nothing in the app could
 * dispatch a curriculum run. It can now (FR-K1), so what is asserted is the
 * button — and that it is the one that *plans*, not the one that teaches, because
 * they are the same endpoint saying two different true things.
 *
 * Pressing it is left to `teach.spec.ts`: the worker is not started by this
 * config and non-negotiable 8 forbids live API calls, so a queued run is as far
 * as any spec goes.
 */

function credentials(): { email: string; password: string } {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `e2e-${unique}@mindforge.test`, password: `pw-${unique}` };
}

async function signUp(page: Page): Promise<void> {
  const { email, password } = credentials();
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const TOPIC = "Postgres row-level security";

test("a mission's curriculum is reachable from its card", async ({ page }) => {
  await signUp(page);

  await page.getByRole("link", { name: "Missions" }).click();
  await page.getByRole("button", { name: "Start your first mission" }).click();
  await page.getByLabel("What do you want to get better at?").fill(TOPIC);
  await page.getByRole("button", { name: "Create mission" }).click();

  const card = page.getByRole("article").filter({ hasText: TOPIC });
  await expect(card).toBeVisible();

  await card.getByRole("link", { name: "Curriculum" }).click();

  // A real URL, because a curriculum is a place: `/missions/<uuid>`.
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/u);
  await expect(page.getByRole("heading", { name: TOPIC })).toBeVisible();

  // The honest state of a mission with no curriculum, offering the action that
  // fills it. "Teach me the next thing" is deliberately absent: the next thing is
  // a plan, and the API picks the agent from the absence of modules rather than
  // from anything this page sends.
  await expect(page.getByText("No curriculum yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan the curriculum" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Teach me the next thing" })).toHaveCount(0);
});
