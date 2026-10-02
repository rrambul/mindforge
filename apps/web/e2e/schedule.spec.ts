import { expect, test, type Page } from "@playwright/test";

/**
 * A module's exam and deadline, end to end (§13.2, M7, FR-E5–E7, FR-U2–U5).
 *
 * The same reason `lesson.spec.ts` exists: the schedule is derived in
 * `packages/core`, read by the API from three tables, parsed by the SPA, and
 * committed back through a `PUT` — four layers with nothing joining them but the
 * response contract. And the exam is a lesson file the reader has to treat
 * differently from every other, which only a real frame and a real row can show.
 *
 * **It signs in as the seeded developer**, for the reason `lesson.spec.ts` gives:
 * `seed:rich` writes the exam file, its attempts and a moved deadline, and nothing
 * else produces them without a paid run. `E2E_SEED_EMAIL` and `E2E_SEED_PASSWORD`
 * point it at another seeded account, so it can run locally without reseeding — and
 * so wiping — the developer's own.
 *
 * It commits a deadline, so it expects a freshly seeded account each run. CI seeds
 * one.
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

async function openRust(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Missions" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: "Rust, properly" })
    .getByRole("link", { name: "Curriculum" })
    .click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/u);
  await expect(page.getByText("Loading")).toHaveCount(0);
}

test("the schedule labels a committed date as due and a derived one as projected", async ({
  page,
}) => {
  await signIn(page);
  await openRust(page);

  const schedule = page.getByRole("region", { name: "Schedule" });
  await expect(schedule).toBeVisible();
  // `seed:rich` commits a deadline on the first module with work left, and moves it.
  await expect(schedule.getByText(/^exam due /u)).toHaveCount(1);
  await expect(schedule.getByText(/^exam projected /u).first()).toBeVisible();
  await expect(page.getByText(/First committed for .+, and moved once\./u)).toBeVisible();
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

test("the module you are in asks for a deadline, prefilled, and commits it in one tap", async ({
  page,
}) => {
  await signIn(page);
  await openRust(page);

  // Its lessons are done and its exam is not passed, so it is the module you are in.
  const field = page.getByLabel("Deadline for Syntax and tooling");
  await expect(field).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u);
  await page.getByRole("button", { name: "Commit" }).click();

  const module = page.getByRole("region", { name: "Syntax and tooling" });
  await expect(module.getByText(/^Due .+, in \d+ days?\./u)).toBeVisible();
  await expect(module.getByRole("button", { name: "Move the deadline" })).toBeVisible();
});
