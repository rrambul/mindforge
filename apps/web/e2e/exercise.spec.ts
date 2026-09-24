import { expect, test, type Page } from "@playwright/test";

/**
 * Doing an exercise, end to end (FR-X2–X5, `PLAN-HANDS-ON.md` Phase 1).
 *
 * Four processes have to agree for this to work, and no unit test can see all of
 * them at once: the API lists the exercise and records the attempt, the lessons
 * origin serves a runner page under its own CSP, the runner frame spins up a Blob
 * worker to execute the learner's TypeScript against agent-written tests, and the
 * SPA brokers the two over `postMessage`. A wrong `frame-ancestors`, a missing
 * `worker-src blob:`, or a bundle that failed to build all look the same from the
 * panel — a button stuck on "Starting the test runner…".
 *
 * **Signs in as the seeded developer**, like `lesson.spec.ts`, because the exercise
 * lives on a seeded lesson with a file behind it. `seed:rich` gives "Leaders and
 * followers" a real exercise whose starter fails four of five tests and whose
 * reference solution passes all of them; this spec types a solution of its own
 * rather than copying that one, so it is the runner being tested and not the seed.
 */

const DEV = { email: "dev@mindforge.local", password: "mindforge-dev" };

const SOLUTION = `export function committedIndex(matchIndex: number[]): number {
  const sorted = matchIndex.slice().sort((a, b) => b - a);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
`;

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(DEV.email);
  await page.getByLabel("Password").fill(DEV.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function openExerciseLesson(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Missions" }).click();
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Distributed systems fundamentals" }) })
    .getByRole("link", { name: "Curriculum" })
    .click();
  await expect(page.getByText("Loading")).toHaveCount(0);

  await page
    .getByRole("listitem")
    .filter({ hasText: "Leaders and followers" })
    .getByRole("link", { name: /^Read/u })
    .click();
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]{36}$/u);
}

test("an exercise runs the learner's code in a sandboxed runner and records the attempt", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await openExerciseLesson(page);

  const panel = page.getByRole("region", { name: "Exercise: Which entries are committed?" });
  await expect(panel).toBeVisible();

  // The runner is a second frame, on the lessons origin, and the same rule holds for
  // it as for the lesson: scripts, and never the same origin (§7.5).
  const runner = page.locator('iframe[title="Test runner"]');
  await expect(runner).toHaveAttribute("src", /^http:\/\/localhost:3001\/runner$/u);
  expect(await runner.getAttribute("sandbox")).toBe("allow-scripts");

  // The hint ladder names its next rung before it is pressed (FR-H1). Not pressed
  // here: the dev API holds a real key, and a press would be a live, billed call —
  // which no automated test may make (non-negotiable 8). The API suite stubs it.
  await expect(panel.getByRole("button", { name: /^(Get a hint|Another hint): /u })).toBeVisible();

  // The button stays disabled until the frame has said it is ready, so an enabled
  // button is the proof that the page, its CSP and its bundle all loaded.
  const run = panel.getByRole("button", { name: "Run tests" });
  await expect(run).toBeEnabled();

  // From the starter, whatever an earlier run left behind: the editor resumes from
  // the last recorded attempt, which is the point of recording it.
  // Disabled when the editor already holds the starter, as it does after a fresh seed.
  const reset = panel.getByRole("button", { name: "Reset to starter" });
  if (await reset.isEnabled()) await reset.click();

  // The starter returns 0: four tests fail, and each says what it expected.
  await run.click();
  await expect(panel.getByText("1 of 5 tests pass")).toBeVisible();
  await expect(panel.getByText("expected 0 to be 7")).toBeVisible();

  // Replace the starter. `insertText` rather than typing, because CodeMirror closes
  // brackets as they are typed and the result would not be the code written here.
  await panel.getByRole("textbox", { name: "Your code for Which entries are committed?" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(SOLUTION);

  await run.click();
  await expect(panel.getByText("5 of 5 tests pass")).toBeVisible();

  await expect(panel.getByText(/^Passed/u)).toBeVisible();

  // Recorded on the server, not only on this page: a fresh browser has no draft in
  // its storage, so the only place the editor can get this code from is the last
  // attempt `exercise_attempts` holds.
  const fresh = await browser.newPage();
  await signIn(fresh);
  await openExerciseLesson(fresh);
  await expect(
    fresh
      .getByRole("region", { name: "Exercise: Which entries are committed?" })
      // Against the editor's whole text: syntax highlighting splits the code across
      // spans, so no single text node holds the expression.
      .getByRole("textbox", { name: "Your code for Which entries are committed?" }),
  ).toContainText("matchIndex.slice()");
  await fresh.close();
});

test("an infinite loop is stopped, and the app stays usable", async ({ page }) => {
  await signIn(page);
  await openExerciseLesson(page);

  const panel = page.getByRole("region", { name: "Exercise: Which entries are committed?" });
  const run = panel.getByRole("button", { name: "Run tests" });
  await expect(run).toBeEnabled();

  await panel.getByRole("textbox", { name: "Your code for Which entries are committed?" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "export function committedIndex(matchIndex: number[]): number {\n  while (true) {}\n}\n",
  );
  await run.click();

  // The loop runs in a worker inside the runner frame, so it is the worker that
  // dies. If it ran on a main thread the two origins share on localhost, the page
  // itself would freeze and this navigation would never happen.
  await expect(panel.getByText(/Stopped after 5 seconds/u)).toBeVisible({ timeout: 15_000 });
  await expect(run).toBeEnabled();
  await page.getByRole("link", { name: "Back to the curriculum" }).click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/u);
});

test("a Python exercise runs on Pyodide in the sandboxed runner, served from this app", async ({
  page,
}) => {
  // Python's interpreter is thirteen megabytes the first time; the test budget is too.
  test.setTimeout(120_000);

  const external: string[] = [];
  page.on("request", (request) => {
    // Network requests only: the runner's worker is a `blob:` URL, which is not one.
    const url = new URL(request.url());
    if (!url.protocol.startsWith("http")) return;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") external.push(url.href);
  });

  await signIn(page);
  await page.getByRole("link", { name: "Missions" }).click();
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Distributed systems fundamentals" }) })
    .getByRole("link", { name: "Curriculum" })
    .click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Clocks and ordering" })
    .getByRole("link", { name: /^Read/u })
    .click();

  const panel = page.getByRole("region", { name: "Exercise: A Lamport clock, on receive" });

  // Python runs on its own page — the only one allowed to fetch its interpreter —
  // and a Python-only lesson loads no JavaScript runner beside it.
  const pythonRunner = page.locator('iframe[title="Python test runner"]');
  await expect(pythonRunner).toHaveAttribute("src", /^http:\/\/localhost:3001\/runner\/python$/u);
  expect(await pythonRunner.getAttribute("sandbox")).toBe("allow-scripts");
  await expect(page.locator('iframe[title="Test runner"]')).toHaveCount(0);

  const run = panel.getByRole("button", { name: "Run tests" });
  await expect(run).toBeEnabled();
  // Only needed after an earlier run left other code behind; it is disabled when
  // the editor already holds the starter.
  const reset = panel.getByRole("button", { name: "Reset to starter" });
  if (await reset.isEnabled()) await reset.click();

  // The starter returns `local`: every test fails, and a bare `assert` names the
  // line that failed rather than just "assertion failed".
  await run.click();
  await expect(panel.getByText("0 of 3 tests pass")).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText("assertion failed: assert on_receive(3, 7) == 8")).toBeVisible();

  await panel.getByRole("textbox", { name: "Your code for A Lamport clock, on receive" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "def on_receive(local: int, received: int) -> int:\n    return max(local, received) + 1\n",
  );
  await run.click();
  await expect(panel.getByText("3 of 3 tests pass")).toBeVisible({ timeout: 30_000 });

  // The interpreter, its WebAssembly and its standard library all came from the
  // lessons origin — nothing from Pyodide's CDN.
  expect(external).toEqual([]);
});
