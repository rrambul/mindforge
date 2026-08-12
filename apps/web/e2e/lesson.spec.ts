import { expect, test, type Page } from "@playwright/test";

/**
 * Reading a lesson and finishing it, without touching a terminal (§13.2, M5).
 *
 * This is the flow M5 exists for, and it is only true end to end: the API mints a
 * grant, a **separate Bun service on another origin** serves the file, the browser
 * renders it in a sandboxed frame, and the outcome written from that page moves a
 * fraction on the screen before it. Every one of those is a different process, and
 * no unit test can tell you they agree — a wrong prefix, a missing service, or a
 * `frame-ancestors` that does not name the app all produce the same empty box.
 *
 * **It signs in as the seeded developer rather than creating an account.** The
 * reader needs content, and content means a lesson row *and* a file in Storage
 * behind it — which only `seed:rich` produces without a paid agent run. That also
 * makes the seed something CI proves rather than something that rots quietly
 * between milestones.
 *
 * The assertions are in English because `seed:rich` writes an English profile.
 * They were in pt-BR while the seed pinned that locale; the split combination —
 * Portuguese interface, English lesson content, §5.2's independent axes — is now
 * `seed:rich --locale=pt-BR`, and is covered at the unit level by the three
 * screens that render with `locale: "pt-BR"`.
 */

const DEV = { email: "dev@mindforge.local", password: "mindforge-dev" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(DEV.email);
  await page.getByLabel("Password").fill(DEV.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The shell only appears once the session is real, so this is also the proof
  // that we are signed in as the seeded user rather than looking at the form.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function openFirstCurriculum(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Missions" }).click();
  await page.getByRole("link", { name: "Curriculum" }).first().click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/u);
  await expect(page.getByText("Loading")).toHaveCount(0);
}

test("a written lesson opens in a sandboxed frame on the lessons origin", async ({ page }) => {
  await signIn(page);
  await openFirstCurriculum(page);

  await page.getByRole("link", { name: /^Read/u }).first().click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}\/lessons\/[0-9a-f-]{36}$/u);

  const frame = page.locator("iframe");
  await expect(frame).toBeVisible();

  // The whole point of the service: a different origin, so the frame cannot reach
  // the app's Supabase session even if everything else fails.
  await expect(frame).toHaveAttribute("src", /^http:\/\/localhost:3001\/v\//u);

  // `allow-scripts` together with `allow-same-origin` lets the frame delete its own
  // sandbox attribute. The two must never appear together (§7.5).
  const sandbox = (await frame.getAttribute("sandbox")) ?? "";
  expect(sandbox).toContain("allow-scripts");
  expect(sandbox).not.toContain("allow-same-origin");

  // The bytes actually arrived — the grant verified, the path resolved, and the
  // content type was right, none of which an empty frame would distinguish.
  await expect(page.frameLocator("iframe").getByText("Seeded content")).toBeVisible();
});

test("the reader gives the lesson the whole window, and keeps a way out of it", async ({
  page,
}) => {
  await signIn(page);

  // The nav is on every other screen, so read it here first — an assertion that it is
  // absent from the reader proves nothing unless it was present a moment earlier.
  const nav = page.getByRole("navigation", { name: "Mindforge" });
  await openFirstCurriculum(page);
  await expect(nav).toBeVisible();

  await page.getByRole("link", { name: /^Read/u }).first().click();

  // The bar loses its nav row on this route and only on this route (`Shell.tsx`). At
  // 375px that row wraps and costs 60px of a 667px screen, all of it out of the lesson.
  await expect(nav).toHaveCount(0);

  /**
   * Which is only acceptable while both of these hold. ⌘K reads the same route table
   * the bar does, and the reader renders its own link back — so removing the nav took
   * away a duplicate rather than the only route to anywhere.
   */
  await expect(page.getByRole("button", { name: "Commands" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the curriculum" })).toBeVisible();

  // A full viewport tall, so scrolling the lesson to the top of the window gives it
  // the whole screen. It was 64% of it while the height subtracted chrome that the
  // page scrolled past anyway.
  const height = await page
    .locator("iframe")
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("No viewport to compare the frame against");
  expect(height).toBeGreaterThanOrEqual(viewport.height);
});

test("the lesson's own JavaScript runs, and cannot reach the network", async ({ page }) => {
  // A lesson is interactive HTML — quizzes and simulators — so `allow-scripts` is
  // load-bearing rather than incidental. `connect-src 'none'` is what makes that
  // safe, and a CSP that blocked the inline script instead would leave the button
  // dead with nothing on screen to say why.
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") blocked.push(message.text());
  });

  await signIn(page);
  await openFirstCurriculum(page);
  await page.getByRole("link", { name: /^Read/u }).first().click();

  const lesson = page.frameLocator("iframe");
  await lesson.getByRole("button", { name: "It should" }).click();

  await expect(lesson.getByText(/cannot reach the network/u)).toBeVisible();
  expect(blocked.filter((text) => /Content Security Policy/u.test(text))).toEqual([]);
});

test("recording an outcome moves the module's fraction, and undoing moves it back", async ({
  page,
}) => {
  await signIn(page);
  await openFirstCurriculum(page);

  const holding = page
    .locator("section.mf-card")
    .filter({ has: page.getByRole("link", { name: /^Read/u }) })
    .first();

  // Pinned by name before anything changes. The filter above is written in terms of
  // a link whose label moves with the lesson's state, and a locator that quietly
  // resolved to a different module afterwards would assert the wrong fraction and
  // pass.
  const moduleName = await holding.getByRole("heading", { level: 2 }).innerText();
  const panel = page.getByRole("region", { name: moduleName });
  const fraction = panel.getByText(/lessons done/u);

  const before = completedIn(await fraction.innerText());
  await holding.getByRole("link", { name: /^Read/u }).first().click();
  const lessonUrl = page.url();

  // Which outcome the seed left, so this run puts it back. The suite shares one
  // database with every other spec, and a test that spends a fixture works once.
  //
  // After the tray is on screen, not before: the chips do not exist while the
  // lesson is loading, and reading them then returns "nothing recorded" for a
  // lesson that is finished — which is the answer that makes the rest pass wrongly.
  await expect(page.getByRole("button", { name: "Shaky" })).toBeVisible();
  const original = await pressedOutcome(page);

  // Down first: a completion cleared has to leave the fraction lower, or "undo" is
  // a button that changes a chip and nothing else.
  if (original !== null) {
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("link", { name: "Back to the curriculum" }).click();
    await expect(fraction).toHaveText(new RegExp(`^${String(before - 1)} of `, "u"));
    await page.goto(lessonUrl);
  }

  // And up: two taps at most, and no dialog in the way (§7.1).
  await page.getByRole("button", { name: "Shaky" }).click();
  await expect(page.getByText("Recorded as Shaky.")).toBeVisible();
  await page.getByRole("link", { name: "Back to the curriculum" }).click();

  // The fraction is what the outcome is *for*. A reader that recorded one and left
  // the plan claiming otherwise would be two screens disagreeing about one row.
  const raised = original === null ? before + 1 : before;
  await expect(fraction).toHaveText(new RegExp(`^${String(raised)} of `, "u"));
  // `.first()`: the seeded module already holds a shaky lesson, which is the point
  // of it — a module where one lesson stays shaky is a state the screen must render.
  await expect(panel.getByText("Shaky").first()).toBeVisible();

  await page.goto(lessonUrl);
  if (original === null) await page.getByRole("button", { name: "Undo" }).click();
  else await page.getByRole("button", { name: original }).click();

  await page.getByRole("link", { name: "Back to the curriculum" }).click();
  await expect(fraction).toHaveText(new RegExp(`^${String(before)} of `, "u"));
});

/** The numerator of "2 of 7 lessons done". */
function completedIn(text: string): number {
  const match = /^(\d+) of/u.exec(text);
  if (match === null) throw new Error(`No fraction in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** Which of the three chips is pressed, or null when nothing was recorded. */
async function pressedOutcome(page: Page): Promise<string | null> {
  for (const name of ["Understood", "Shaky", "Lost"]) {
    if ((await page.getByRole("button", { name, pressed: true }).count()) > 0) return name;
  }
  return null;
}

test("the library lists the reference shelf and what was written down", async ({ page }) => {
  await signIn(page);
  await openFirstCurriculum(page);

  await page.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}\/library$/u);

  // Served from the lessons origin like a lesson, and opened beside the work
  // rather than inside a frame you cannot leave open.
  const open = page.getByRole("link", { name: "Open" }).first();
  await expect(open).toHaveAttribute("href", /^http:\/\/localhost:3001\/v\//u);
  await expect(open).toHaveAttribute("rel", "noreferrer");

  await expect(page.getByText("What you learned").first()).toBeVisible();
});
