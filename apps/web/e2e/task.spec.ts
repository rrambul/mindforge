import { expect, test, type Page } from "@playwright/test";

/**
 * A task exercise — code the learner runs on their own machine (FR-X10).
 *
 * The only exercise kind this suite can drive all the way through: reporting a
 * result calls nothing and bills nothing, so the whole loop runs against the real
 * stack. What it proves is the honesty of the loop — the panel says the app cannot
 * run this language, gives every file and the command, and records what the
 * learner says as theirs rather than as a pass it checked.
 */

const DEV = { email: "dev@mindforge.local", password: "mindforge-dev" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(DEV.email);
  await page.getByLabel("Password").fill(DEV.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("a task gives every file and the command, and records the learner's own report", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await page.getByRole("link", { name: "Missions" }).click();
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Rust, properly" }) })
    .getByRole("link", { name: "Curriculum" })
    .click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Moves and copies" })
    .getByRole("link", { name: /^Read/u })
    .click();

  const panel = page.getByRole("region", { name: "Exercise: Borrow, don't move" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/can't run Rust in the browser/u)).toBeVisible();
  for (const path of ["Cargo.toml", "src/lib.rs", "tests/longest_word.rs"]) {
    await expect(panel.getByText(path, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText("cargo test", { exact: true })).toBeVisible();

  // Copying a file puts exactly its contents on the clipboard.
  await panel.getByRole("button", { name: "Copy src/lib.rs" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "pub fn longest_word(text: String) -> String",
  );

  // No runner, no hints: the app runs nothing for this exercise.
  await expect(page.locator('iframe[title="Test runner"]')).toHaveCount(0);
  await expect(page.locator('iframe[title="Python test runner"]')).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^(Get a hint|Another hint)/u })).toHaveCount(0);

  await panel
    .getByLabel("Paste what your terminal printed (optional)")
    .fill("error[E0308]: mismatched types");
  await panel.getByRole("button", { name: "Not yet" }).click();
  await expect(panel.getByText("Last report: not yet")).toBeVisible();

  await panel.getByRole("button", { name: "Tests pass" }).click();
  await expect(panel.getByText("Last report: tests pass")).toBeVisible();
  // Always the learner's word — "you reported", never a bare "passed".
  await expect(panel.getByText(/^You reported a pass/u)).toBeVisible();
});
