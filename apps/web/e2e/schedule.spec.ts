import { expect, test, type Page } from "@playwright/test";

/**
 * A module's exam, the week calendar and a lab, end to end (§13.2, M7, FR-E5–E7, FR-B1–B6,
 * FR-X11).
 *
 * The same reason `lesson.spec.ts` exists: the schedule is derived in
 * `packages/core`, read by the API from three tables, parsed by the SPA, and
 * committed back through a `PUT` — four layers with nothing joining them but the
 * response contract. And the exam is a lesson file the reader has to treat
 * differently from every other, which only a real frame and a real row can show.
 *
 * **It signs in as the seeded developer**, for the reason `lesson.spec.ts` gives:
 * `seed:rich` writes the exam file, its attempts, a mission planned in weeks and a
 * lesson with a lab, and nothing else produces them without a paid run. `E2E_SEED_EMAIL` and `E2E_SEED_PASSWORD`
 * point it at another seeded account, so it can run locally without reseeding — and
 * so wiping — the developer's own.

 */

const SEEDED = {
  email: process.env["E2E_SEED_EMAIL"] ?? "dev@mindforge.local",
  password: process.env["E2E_SEED_PASSWORD"] ?? "mindforge-dev",
};

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(SEEDED.email);
  await page.getByLabel("Password").fill(SEEDED.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function openMission(page: Page, topic: string): Promise<void> {
  await page.getByRole("link", { name: "Missions" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: topic })
    .getByRole("link", { name: "Curriculum" })
    .click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/u);
  await expect(page.getByText("Loading")).toHaveCount(0);
}

const openRust = (page: Page) => openMission(page, "Rust, properly");

test("a mission planned in weeks shows each week against its dates", async ({ page }) => {
  await signIn(page);
  await openMission(page, "AWS serverless, by doing");

  const weeks = page.getByRole("region", { name: "Weeks" });
  await expect(weeks).toBeVisible();
  await expect(
    weeks.getByText(/^3 weeks, .+ Lessons on days 1–5, the exam on day 6\.$/u),
  ).toBeVisible();
  // `seed:rich` puts week 1 behind today and week 2 around it.
  await expect(weeks.getByText("Week 1 · Storage and permissions")).toBeVisible();
  await expect(weeks.getByText("Week 3 · HTTP APIs")).toBeVisible();

  const week1 = page.getByRole("region", { name: "Storage and permissions" });
  await expect(week1.getByText(/^Week 1 · .+ · exam on /u)).toBeVisible();
  // Its lessons are done and its exam half passed: the week ended, the module did not.
  await expect(week1.getByText(/its exam is not passed\.$/u)).toBeVisible();
});

test("a lesson can carry a lab in your own account, cost first and cleanup last", async ({
  page,
}) => {
  await signIn(page);
  await openMission(page, "AWS serverless, by doing");

  const week1 = page.getByRole("region", { name: "Storage and permissions" });
  await week1
    .getByRole("listitem")
    .filter({ hasText: "Bucket policies in practice" })
    .getByRole("link", { name: /^Read/u })
    .click();
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}$/u);

  await expect(
    page.getByText("Free tier: one bucket with one small object costs nothing."),
  ).toBeVisible();
  await expect(page.getByText("Clean up when you're done")).toBeVisible();
  await expect(
    page.getByText("Never paste keys, tokens or passwords. Remove any before you report."),
  ).toBeVisible();
});

test("a half-passed exam names what to revisit, and the reader gives it no chip and no help", async ({
  page,
}) => {
  await signIn(page);
  await openRust(page);

  const module = page.getByRole("region", { name: "Syntax and tooling" });
  await expect(module.getByText("Exam: 1 of 2 items passed.")).toBeVisible();
  await expect(module.getByText("To revisit:")).toBeVisible();

  await module.getByRole("link", { name: "Exam: Syntax and tooling" }).click();
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}$/u);

  // The same sandboxed frame as any lesson: an exam is a lesson file.
  await expect(page.locator("iframe").first()).toHaveAttribute(
    "src",
    /^http:\/\/localhost:3001\//u,
  );
  await expect(
    page.getByText(/This is the module's exam\. There's nothing to mark/u),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Understood" })).toHaveCount(0);
  // Two items: the failed one offers no help, and the passed one has its help back.
  await expect(
    page.getByText("No hints and no answer in an exam. They open once you've passed this item."),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Get a hint/u })).toHaveCount(1);
});
