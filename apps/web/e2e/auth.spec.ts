import { expect, test, type Page } from "@playwright/test";

/**
 * Sign up → sign in → sign out (§13.2, first flow: "auth is the front door").
 *
 * The one flow that can lock a user out of the product entirely, and the reason
 * `apps/web/vitest.config.ts` excludes `App.tsx`, `providers.tsx`, `SignInForm`, and
 * `use-supabase-session` from unit coverage. Those exclusions were written against this file before it
 * existed.
 *
 * Nothing is stubbed. The point is the parts a jsdom test cannot reach: that Supabase Auth issues a
 * real token, that the token survives a reload through `localStorage`, that the API's guard accepts it,
 * and that a profile row appears — the guard rejects a valid token with no profile, so the trigger
 * firing is part of the front door whether it looks like it or not.
 */

/** Unique per run, so a failed run leaves nothing that makes the next one fail for the wrong reason. */
function credentials(): { email: string; password: string } {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `e2e-${unique}@mindforge.test`, password: `pw-${unique}` };
}

async function fillCredentials(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
}

/** Today is the signed-in landing screen, and its nav is the thing only a session renders. */
function signedIn(page: Page) {
  return page.getByRole("button", { name: "Sign out" });
}

test.describe("the front door", () => {
  test("signs up, lands signed in, survives a reload, and signs out", async ({ page }) => {
    const { email, password } = credentials();

    await page.goto("/");

    // Signed out: the form, and none of the app.
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(signedIn(page)).toBeHidden();

    await page.getByRole("button", { name: "Create an account instead" }).click();
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();

    await fillCredentials(page, email, password);
    await page.getByRole("button", { name: "Create account" }).click();

    // No success message is rendered by design — `onAuthStateChange` fires and the shell re-renders.
    // So the assertion is that the app appeared, which is the only honest signal there is.
    await expect(signedIn(page)).toBeVisible();
    // A link, not a button, since M2's route tree. That is the point of the change rather than an
    // incidental detail: middle-click, ⌘-click and a screen reader's link list all do nothing on a
    // button, and this assertion is what caught the nav still being one.
    await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/u);

    /**
     * The reload proves the session survives it — read back out of `localStorage` and re-verified.
     *
     * What it does **not** catch is the sign-in form *flashing* while the stored session is still being
     * read. `toBeVisible` retries until the final state settles, so a flash passes. Verified by breaking
     * the `sessionKnown` guard and watching this still go green.
     *
     * Catching a flash needs an assertion about a moment rather than an outcome, and every version of
     * that is a race. Left uncovered and written down rather than claimed.
     */
    await page.reload();
    await expect(signedIn(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeHidden();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(signedIn(page)).toBeHidden();

    // And signing out means it: a reload does not bring the session back.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("signs back in with the same credentials", async ({ page }) => {
    // Sign-up and sign-in are different Supabase calls, so proving one says nothing about the other.
    const { email, password } = credentials();

    await page.goto("/");
    await page.getByRole("button", { name: "Create an account instead" }).click();
    await fillCredentials(page, email, password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(signedIn(page)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await fillCredentials(page, email, password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(signedIn(page)).toBeVisible();
  });

  test("reaches the API with the token it was issued", async ({ page }) => {
    // The half a jsdom test cannot reach: the guard verifies the signature against Supabase's published
    // JWKS, so a hand-minted token would prove nothing. If the profile trigger had not fired, the guard
    // would reject a perfectly valid token and this screen would be an error instead.
    const { email, password } = credentials();

    await page.goto("/");
    await page.getByRole("button", { name: "Create an account instead" }).click();
    await fillCredentials(page, email, password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(signedIn(page)).toBeVisible();

    // The library is empty for a new account, and its empty state is server-confirmed: rendering it
    // means `GET /v1/resources` answered 200 rather than 401.
    await page.getByRole("link", { name: "Library" }).click();
    // The URL changing is the other half of what the route tree bought: before M2 this screen could
    // not be linked to, bookmarked, or reached with Back.
    await expect(page).toHaveURL(/\/library$/u);
    await expect(page.getByText(/Paste a link to anything/)).toBeVisible();
  });

  test("refuses a wrong password without saying which part was wrong", async ({ page }) => {
    // Supabase's own text distinguishes "invalid credentials" from "email not confirmed", which leaks
    // whether an account exists. Both collapse to one catalogued message, and this asserts that.
    const { email, password } = credentials();

    await page.goto("/");
    await page.getByRole("button", { name: "Create an account instead" }).click();
    await fillCredentials(page, email, password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(signedIn(page)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await fillCredentials(page, email, "not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "That email and password don't match an account.",
    );
    await expect(signedIn(page)).toBeHidden();
  });

  test("says nothing revealing about an account that does not exist", async ({ page }) => {
    // The same message as a wrong password, which is the point — a different one would be an oracle for
    // which emails are registered.
    await page.goto("/");
    await fillCredentials(page, `nobody-${Date.now()}@mindforge.test`, "whatever-1234");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "That email and password don't match an account.",
    );
  });
});

test("does not serve one user's data to the next in the same tab", async ({ page }) => {
  // The query client lives for the app's lifetime, `signOut()` only clears Supabase's storage, and no
  // query key is scoped by user — so before this was fixed the second user rendered with the first
  // user's profile.
  //
  // Asserted on the **interface language**, and that choice is the whole test. `["me"]` is the query
  // with `staleTime: Infinity`, so it is the one that never re-fetches away the problem — and
  // `App.tsx` reads its `locale` to pick the bundle every string renders from. Settings has its own
  // query for the same row, which refetches on mount and would hide the bug: an earlier version of
  // this test read the timezone field there and passed with the fix reverted.
  //
  // Only observable here. Every jsdom test builds a fresh QueryClient per render, so a cache cannot
  // survive anything, and no other spec signs two users in.
  const first = credentials();
  const second = credentials();

  await page.goto("/");
  await page.getByRole("button", { name: "Create an account instead" }).click();
  await fillCredentials(page, first.email, first.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(signedIn(page)).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Interface language").selectOption("pt-BR");
  // Two forms on the screen each have a Save; this one belongs to the calendar section.
  await page.getByLabel("Language and calendar").getByRole("button", { name: "Save" }).click();
  // The whole shell re-renders in Portuguese, which is how we know `["me"]` now holds pt-BR.
  await expect(page.getByRole("link", { name: "Hoje" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: /Entrar|Sign in/ })).toBeVisible();

  await page.getByRole("button", { name: /Criar uma conta|Create an account instead/ }).click();
  // The front door is in Portuguese now, so its field labels are too — which is itself the proof
  // that the first user's locale reached the shell.
  await page.getByLabel(/E-mail|Email/).fill(second.email);
  await page.getByLabel(/Senha|Password/).fill(second.password);
  await page.getByRole("button", { name: /Criar conta|Create account/ }).click();

  // A fresh account is `en`. Seeing Portuguese here is the first user's profile still in the cache.
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hoje" })).toBeHidden();
});
