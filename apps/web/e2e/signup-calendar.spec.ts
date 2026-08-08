import { expect, test } from "@playwright/test";

/**
 * A new account is seeded from the browser it signed up in (FR-L1, FR-L2, FR-L3, FR-L5).
 *
 * The only thing that can create a profile is a trigger on `auth.users` — Prisma cannot own that
 * table — and a trigger knows nothing about the browser on the other end. So every account started
 * at `locale: 'en'`, `timezone: 'UTC'` and `weekStartsOn: 1` no matter who or where it was, and
 * FR-L5's "seeded from locale" described a column nobody wrote: `defaultWeekStartsOn` sat in
 * `packages/core` with tests and no callers.
 *
 * Only reachable here. The trigger, the browser's own idea of its locale and zone, and the settings
 * write path are three different processes, and the unit test can assert what the client *sent* but
 * not what a real account ends up holding.
 */
test.describe("a Brazilian browser", () => {
  // The whole point of the test, and the reason the config pins these globally: everything else in
  // the suite asserts on weeks, so it must not be calibrated by the machine that runs it.
  test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

  test("gets an account whose week starts on Sunday, in its own timezone", async ({ page }) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await page.goto("/");
    // In Portuguese already — the sign-in screen has no profile to read, so it runs on the browser's
    // guess. What this test is about is whether the *account* then agrees with it.
    await page.getByRole("button", { name: "Criar uma conta" }).click();
    await page.getByLabel("E-mail").fill(`e2e-${unique}@mindforge.test`);
    await page.getByLabel("Senha").fill(`pw-${unique}`);
    /**
     * Waited for explicitly, because "signed in" happens well before "seeded".
     *
     * `onAuthStateChange` fires inside `signUp`, so the shell — and its sign-out button — is on screen
     * while the seed is still in flight. Navigating on that alone made this race the write: it passed
     * because the server had finished by the time Settings asked, and a slower round trip would have
     * read the pre-seed row. It also aborted the request mid-flight, which the client correctly
     * reported as a network failure of something that had in fact landed.
     */
    const seeded = page.waitForResponse(
      (response) => response.url().endsWith("/v1/me") && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Criar conta" }).click();
    expect((await seeded).status()).toBe(200);
    // Still in Portuguese now that the profile is what decides, rather than the browser (FR-L1).
    // Asserted after the seed rather than before it: unseeded, this button reads "Sign out", and a
    // suite should fail on the cause rather than three assertions downstream of it.
    await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();

    await page.goto("/settings");

    // 0 is Sunday, which is the pt-BR convention and was Monday for every account before this.
    await expect(page.getByLabel("A semana começa em")).toHaveValue("0");
    // §5.2: every day boundary, week and nightly rollup derives from this one.
    await expect(page.getByLabel("Fuso horário")).toHaveValue("America/Sao_Paulo");
    // FR-L3 — it starts on the interface language and is separately overridable afterwards, which is
    // why it is its own column rather than a read of `locale`.
    await expect(page.getByLabel("Idioma das lições")).toHaveValue("pt-BR");
  });
});
