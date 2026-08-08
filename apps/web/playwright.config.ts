import { defineConfig, devices } from "@playwright/test";

/**
 * The E2E level (§13.2) — real browser, real stack, no mocks anywhere.
 *
 * This config did not exist for the whole of M1, and `@playwright/test` was installed the whole time.
 * `pnpm test:e2e` crashed with an internal assertion, nothing ran it in CI, and meanwhile
 * `apps/web/vitest.config.ts` excluded 378 lines — `App.tsx`, `providers.tsx`, `SignInForm`,
 * `use-supabase-session` — on the stated grounds that Playwright covered them. It did not. Sign up →
 * sign in → sign out, the front door and the one flow that can lock a user out entirely, was untested
 * at every level.
 *
 * §13.2 lists eight flows. Only the auth one is here; the rest are named in `e2e/README.md` so the gap
 * is a list rather than a surprise.
 */
export default defineConfig({
  testDir: "./e2e",
  // Serial. These share one database and one Supabase Auth instance, so parallel workers would fight
  // over rows — the same reason the API's integration config sets `fileParallelism: false`.
  workers: 1,
  fullyParallel: false,
  // A failure here is a real failure. Retries would turn a genuine auth regression into a flake that
  // passes on the second attempt and gets ignored.
  retries: 0,
  // Generous: this waits on a browser, a dev server, and a round trip through GoTrue.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // `list` in both places. The GitHub annotator would need a `process.env.CI` check, and `process`
  // does not belong in this package's type environment — only `VITE_*` reaches the browser, and adding
  // Node types here would let a component write `process.env` and typecheck.
  reporter: [["list"]],

  use: {
    // Hardcoded because the dev server uses `strictPort`: 5173 is either free or the run fails loudly,
    // which is the whole point of that setting (see CLAUDE.md).
    baseURL: "http://localhost:5173",
    /**
     * Both pinned, because a new account is now seeded from the browser rather than left on UTC.
     *
     * Playwright's defaults are the machine's locale and zone, so without these a signup writes
     * whatever the developer happens to be in — and `weekly-rhythm.spec.ts` asserts on a week, which
     * is exactly the thing that moves. A suite about days and weeks cannot be calibrated by the
     * machine that runs it. `signup-calendar.spec.ts` overrides them on purpose, which is the point
     * of it.
     */
    locale: "en-US",
    timezoneId: "UTC",
    // Only on failure, and only then: a trace per test is hundreds of megabytes of CI artifact for
    // runs nobody looks at.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // Chromium only. A second engine doubles the slowest gate in the pipeline to catch rendering
  // differences this suite does not assert on — the flows are about behaviour, and §13.3 gives CI a
  // 12-minute budget for everything.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /**
   * Both servers, started by Playwright.
   *
   * `reuseExistingServer` is set explicitly even though its documented default is `!process.env.CI`.
   * Leaving it off was tried and refused to reuse a running dev server with `CI` unset — so the
   * documented default and the observed behaviour disagree, and the explicit value is the one that
   * works. Locally a dev session you already have open is used rather than fought with; never in CI,
   * where a stale process would silently serve the previous commit.
   */
  webServer: [
    {
      command: "pnpm --filter @mindforge/api dev",
      url: "http://localhost:3000/v1/health",
      cwd: "../..",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @mindforge/web dev",
      url: "http://localhost:5173",
      cwd: "../..",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
