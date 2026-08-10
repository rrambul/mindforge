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
 * **The assertions are in pt-BR, and that is deliberate.** The seeded profile is
 * `locale: pt-BR` with English lesson content (§5.2's three independent axes), so
 * this run is also the check that the reader's own chrome translates while the
 * agent's HTML does not. The sign-in form is English because the profile's locale
 * is not known until after it is used.
 */

const DEV = { email: "dev@mindforge.local", password: "mindforge-dev" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(DEV.email);
  await page.getByLabel("Password").fill(DEV.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The profile's locale lands with the session, so the bar is the first thing in
  // Portuguese — and the first proof that we are signed in as the seeded user.
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
}

async function openFirstCurriculum(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Missões" }).click();
  await page.getByRole("link", { name: "Currículo" }).first().click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/u);
  await expect(page.getByText("Carregando")).toHaveCount(0);
}

test("a written lesson opens in a sandboxed frame on the lessons origin", async ({ page }) => {
  await signIn(page);
  await openFirstCurriculum(page);

  await page.getByRole("link", { name: /^Ler/u }).first().click();
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
  await page.getByRole("link", { name: /^Ler/u }).first().click();

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
    .filter({ has: page.getByRole("link", { name: /^Ler/u }) })
    .first();

  // Pinned by name before anything changes. The filter above is written in terms of
  // a link whose label moves with the lesson's state, and a locator that quietly
  // resolved to a different module afterwards would assert the wrong fraction and
  // pass.
  const moduleName = await holding.getByRole("heading", { level: 2 }).innerText();
  const panel = page.getByRole("region", { name: moduleName });
  const fraction = panel.getByText(/lições concluídas/u);

  const before = completedIn(await fraction.innerText());
  await holding.getByRole("link", { name: /^Ler/u }).first().click();
  const lessonUrl = page.url();

  // Which outcome the seed left, so this run puts it back. The suite shares one
  // database with every other spec, and a test that spends a fixture works once.
  //
  // After the tray is on screen, not before: the chips do not exist while the
  // lesson is loading, and reading them then returns "nothing recorded" for a
  // lesson that is finished — which is the answer that makes the rest pass wrongly.
  await expect(page.getByRole("button", { name: "Inseguro" })).toBeVisible();
  const original = await pressedOutcome(page);

  // Down first: a completion cleared has to leave the fraction lower, or "undo" is
  // a button that changes a chip and nothing else.
  if (original !== null) {
    await page.getByRole("button", { name: "Desfazer" }).click();
    await page.getByRole("link", { name: "Voltar ao currículo" }).click();
    await expect(fraction).toHaveText(new RegExp(`^${String(before - 1)} de `, "u"));
    await page.goto(lessonUrl);
  }

  // And up: two taps at most, and no dialog in the way (§7.1).
  await page.getByRole("button", { name: "Inseguro" }).click();
  await expect(page.getByText("Registrado como Inseguro.")).toBeVisible();
  await page.getByRole("link", { name: "Voltar ao currículo" }).click();

  // The fraction is what the outcome is *for*. A reader that recorded one and left
  // the plan claiming otherwise would be two screens disagreeing about one row.
  const raised = original === null ? before + 1 : before;
  await expect(fraction).toHaveText(new RegExp(`^${String(raised)} de `, "u"));
  // `.first()`: the seeded module already holds a shaky lesson, which is the point
  // of it — a module where one lesson stays shaky is a state the screen must render.
  await expect(panel.getByText("Inseguro").first()).toBeVisible();

  await page.goto(lessonUrl);
  if (original === null) await page.getByRole("button", { name: "Desfazer" }).click();
  else await page.getByRole("button", { name: original }).click();

  await page.getByRole("link", { name: "Voltar ao currículo" }).click();
  await expect(fraction).toHaveText(new RegExp(`^${String(before)} de `, "u"));
});

/** The numerator of "2 de 7 lições concluídas". */
function completedIn(text: string): number {
  const match = /^(\d+) de/u.exec(text);
  if (match === null) throw new Error(`No fraction in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** Which of the three chips is pressed, or null when nothing was recorded. */
async function pressedOutcome(page: Page): Promise<string | null> {
  for (const name of ["Entendi", "Inseguro", "Me perdi"]) {
    if ((await page.getByRole("button", { name, pressed: true }).count()) > 0) return name;
  }
  return null;
}

test("the library lists the reference shelf and what was written down", async ({ page }) => {
  await signIn(page);
  await openFirstCurriculum(page);

  await page.getByRole("link", { name: "Biblioteca" }).click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}\/library$/u);

  // Served from the lessons origin like a lesson, and opened beside the work
  // rather than inside a frame you cannot leave open.
  const open = page.getByRole("link", { name: "Abrir" }).first();
  await expect(open).toHaveAttribute("href", /^http:\/\/localhost:3001\/v\//u);
  await expect(open).toHaveAttribute("rel", "noreferrer");

  await expect(page.getByText("O que você aprendeu").first()).toBeVisible();
});
