import { expect, test, type Page } from "@playwright/test";

/**
 * Weekly plan → log a session → the review shows plan vs. actual (§13.2, M2's flow).
 *
 * The one flow §13.2 names for this milestone, and the one that would have caught M2's worst defect.
 * The plan grid was correct, plan-vs-actual was correct, and the review was correct — each proven by
 * its own tests — while `StartFocus` wrote no subject at all. So a user could allocate four hours to a
 * mission, log every one of them, and read 0m. Every layer passed; the path did not exist.
 *
 * That is what this asserts and no other level can: three screens and two round trips, joined by a
 * column. A unit test stubs the join away, and an integration test cannot press the picker.
 *
 * **Minutes come from the retroactive path, not the timer.** A session started and stopped inside a
 * test lasts zero minutes, so the actual would read 0 whether or not anything worked — the assertion
 * would pass against the very bug it exists for. FR-F2's form takes a date, a start time and a
 * duration, which is a real hour the review can be checked against.
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

/**
 * The Monday of the current week, in UTC.
 *
 * A fresh account is UTC and starts its week on Monday, so this is the week the app will resolve for
 * `/weeks/<date>` — and the session below is dated inside it. Derived rather than hardcoded, because a
 * fixed date would put the session outside the window the moment the calendar moved past it.
 */
function thisMonday(): string {
  const today = new Date(Date.now());
  const utcMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const weekday = new Date(utcMidnight).getUTCDay();
  // getUTCDay is 0 for Sunday, so Sunday belongs to the week that began six days earlier.
  const shift = weekday === 0 ? 6 : weekday - 1;
  return new Date(utcMidnight - shift * 86_400_000).toISOString().slice(0, 10);
}

const TOPIC = "Rust, properly";

test("a week's plan meets the hours actually worked", async ({ page }) => {
  await signUp(page);

  // A mission to plan against. The grid says as much when there is nothing: "Nothing to allocate to
  // yet. Start a mission or add a skill, then come back."
  await page.getByRole("link", { name: "Missions" }).click();
  // A fresh account's empty state names the action rather than offering a generic "New mission".
  await page.getByRole("button", { name: "Start your first mission" }).click();
  await page.getByLabel("What do you want to get better at?").fill(TOPIC);
  await page.getByRole("button", { name: "Create mission" }).click();
  await expect(page.getByText(TOPIC)).toBeVisible();

  // Two hours planned for this week.
  const week = thisMonday();
  await page.goto(`/weeks/${week}`);
  // The grid labels each box with its subject's own name, which is what makes it readable and also
  // what makes this locatable.
  await page.getByLabel(TOPIC).fill("120");
  await page.getByRole("button", { name: "Save the week" }).click();
  await expect(page.getByText("Unsaved changes.")).toBeHidden();

  // Before any work, the plan exists and the actual is a real zero — a measurement, not a gap.
  // Durations are rendered by `Intl.NumberFormat` with unit style, so the spacing is the platform's
  // and not ours to hardcode.
  await expect(page.getByText(/0\s*min\s+worked against\s+2\s*hr?\s+planned/i)).toBeVisible();

  /**
   * An hour of work, filed under that mission.
   *
   * This is the step that did not exist. `LogPastSession` had four fields and no subject picker, so a
   * backfilled session carried no `mission_id` — and the assertion below would have read 0m against
   * a plan of 120, with every underlying layer behaving exactly as its own tests said.
   */
  await page.getByRole("link", { name: "Today" }).click();
  await page.getByRole("button", { name: "Log a session you forgot to time" }).click();

  // Scoped to the form's own section. Today shows the timer above it, so "Minutes" and the subject
  // picker exist twice on the page — which is exactly why the retroactive picker is labelled in the
  // past tense rather than sharing the timer's wording.
  const past = page.getByLabel("Log a past session");
  await past.getByLabel("Date").fill(week);
  await past.getByLabel("Started at").fill("09:00");
  await past.getByLabel("Minutes").fill("60");
  await past.getByLabel("What was this about?").selectOption({ label: `Mission · ${TOPIC}` });
  await past.getByRole("button", { name: "Log it" }).click();

  // And the week now knows about it. This is the assertion the whole file exists for: it read
  // "0 min worked against 2 hr" before the picker existed, with every layer's own tests green.
  await page.goto(`/weeks/${week}`);
  await expect(page.getByText(/1\s*hr?\s+worked against\s+2\s*hr?\s+planned/i)).toBeVisible();

  // The review is the screen M2's finish line is measured on, and it reads the same hour.
  await page.goto(`/weeks/${week}/review`);
  await expect(page.getByRole("heading", { name: /Weekly review/i })).toBeVisible();
  // The section only exists when something was both planned and worked, so its presence is already
  // the assertion. The ratio is read off the progressbar rather than the figures: a row prints
  // planned, actual and difference, and two of those say "1 hr" this week — matching text would pass
  // on the difference alone.
  const moved = page.getByLabel("What moved");
  await expect(moved.getByText(TOPIC)).toBeVisible();
  await expect(
    moved.getByRole("progressbar", { name: `Actual against planned for ${TOPIC}` }),
  ).toHaveAttribute("aria-valuenow", "50");

  /**
   * And the one thing you are changing, which is the column the milestone is counted in.
   *
   * `changed_one_thing` exists so "three weekly reviews and changed one thing because of one" is
   * observable rather than remembered, and it was erasable until recently: the screen found an
   * existing review by scanning a list the API caps at 52.
   */
  await page.getByLabel("What are you changing?").fill("Mornings only");
  await page.getByRole("button", { name: "Complete the review" }).click();

  // Read back on a fresh load, which is the half that proves it persisted.
  await page.goto(`/weeks/${week}/review`);
  await expect(page.getByLabel("What are you changing?")).toHaveValue("Mornings only");
});
