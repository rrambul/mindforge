import { expect, test, type Page } from "@playwright/test";

/**
 * Press "Teach me the next thing" → a run exists (§13.2, M3's flow).
 *
 * **What this covers, and what it deliberately does not.** It ends at the run
 * being queued and reported back on the card. It does not wait for a lesson: the
 * worker is not started by this config, and non-negotiable 8 forbids live API
 * calls in the suite — a spec that called a model would cost money on every push
 * and fail whenever Anthropic had a bad afternoon. The rest of the pipeline is
 * proved by the worker's own suites against recorded transcripts, and by one
 * real run recorded in the M3 commit message.
 *
 * **It is still the only level that can catch the gap it exists for.** M2's worst
 * defect was every layer green and the path absent, and M3 has the same shape
 * available: the button is in `features/teach`, the endpoint is in the API's
 * `teach` module, the mission card is in `features/missions`, and nothing joins
 * them except a render prop threaded through `app/MissionsScreen`. A unit test
 * mocks the fetch; an integration test cannot press the button. This is where a
 * missing `renderTeach` shows up.
 *
 * It also pins the two things the card must say, because both are decisions
 * rather than defaults: the button is *disabled and labelled*, not hidden, while
 * a run is live, and a queued run says so in words.
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

test("a mission can be sent to the teach agent", async ({ page }) => {
  await signUp(page);

  await page.getByRole("link", { name: "Missions" }).click();
  await expect(page).toHaveURL(/\/missions$/u);

  // A fresh account's empty state names the action rather than offering a generic
  // "New mission" — same as `weekly-rhythm.spec.ts`.
  await page.getByRole("button", { name: "Start your first mission" }).click();
  await page.getByLabel("What do you want to get better at?").fill(TOPIC);
  await page.getByRole("button", { name: "Create mission" }).click();

  const card = page.getByRole("article").filter({ hasText: TOPIC });
  await expect(card).toBeVisible();

  // The join this spec exists for. If `renderTeach` were not threaded through
  // `MissionsScreen`, every unit test would still pass and this button would not
  // be here.
  const teach = card.getByRole("button", { name: "Teach me the next thing" });
  await expect(teach).toBeEnabled();

  await teach.click();

  // Queued, not finished. The worker is not running in this suite, so this is
  // where the flow correctly stops — and the card has to say so rather than
  // looking like nothing happened.
  await expect(card.getByText(/Queued|Writing you a lesson/u)).toBeVisible();

  // Disabled and relabelled rather than hidden: the button is where the learner
  // looks, and removing it makes the page feel broken.
  await expect(card.getByRole("button", { name: "Teaching…" })).toBeDisabled();
});

test("a parked mission is not offered to the agent", async ({ page }) => {
  // Parking is a statement that you are not working on something (FR-M4b), so
  // offering to teach it is the contradiction `MissionParked` refuses for a
  // weekly allocation. Asserted here because it is a composition decision — the
  // card decides, and no API call is involved to catch it anywhere else.
  await signUp(page);

  await page.getByRole("link", { name: "Missions" }).click();
  await page.getByRole("button", { name: "Start your first mission" }).click();
  await page.getByLabel("What do you want to get better at?").fill(TOPIC);
  await page.getByRole("button", { name: "Create mission" }).click();

  const card = page.getByRole("article").filter({ hasText: TOPIC });
  await expect(card.getByRole("button", { name: "Teach me the next thing" })).toBeVisible();

  await card.getByRole("button", { name: "Park" }).click();

  await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Teach me the next thing" })).toHaveCount(0);
});
