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
 * It stops at a mission with no curriculum yet, deliberately — and that is not
 * only a suite limitation. Curricula are authored from a terminal for now: nothing
 * in the app dispatches a curriculum run, so the empty state a fresh mission shows
 * is the honest end of this flow. What is asserted is that it names the command
 * that does work rather than a button that does not (§5.3).
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

  // The honest state of a mission with no curriculum, naming the action that
  // actually writes one. The teach button is deliberately absent here: it queues a
  // lesson, and the `teach` skill never writes CURRICULUM.md.
  await expect(page.getByText("No curriculum yet")).toBeVisible();
  await expect(page.getByText("/curriculum")).toBeVisible();
  await expect(page.getByRole("button", { name: "Teach me the next thing" })).toHaveCount(0);
});
