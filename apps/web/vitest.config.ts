import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Vitest replaces vite.config.ts rather than extending it, so the workspace-root
  // .env.local has to be pointed at again here — otherwise import.meta.env is empty and
  // every module that validates it throws at import time.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  // Workspace packages resolve to source, not to their built `dist`. A suite that read
  // dist would pass against whatever was built last, so an edit to packages/core would
  // appear to do nothing until someone rebuilt it.
  resolve: {
    alias: {
      "@mindforge/core": pkg("core"),
      "@mindforge/db": pkg("db"),
      "@mindforge/llm": pkg("llm"),
    },
  },
  test: {
    // Only the unit tests under `src`. Vitest's default glob also matches `.spec.` files, which swept
    // up the Playwright spec the moment it existed and tried to run it — `test.describe` there is
    // Playwright's, not Vitest's. Naming the include keeps the two levels from colliding rather than
    // relying on a file-naming convention nobody wrote down.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // Vitest's default is 5s, which on this suite measures the machine rather than the
    // code. 34 files each build a jsdom and an MSW server — cumulative environment setup
    // runs past four minutes — so when the workers oversubscribe the CPU, a `findBy*`
    // waiting on a mocked fetch loses its budget to scheduling and the run comes back
    // with seven failures in files nobody touched. Observed 2026-08-12: the same suite
    // failed 1, then 8, then 7 tests on three consecutive runs, passed all 381 at 20s,
    // and every file passed alone in seconds.
    //
    // This is not a slow test being accommodated. These assertions resolve in
    // milliseconds on an idle worker; the timeout exists to catch a promise that never
    // settles, and it still does that — just later. Lowering it again buys nothing and
    // makes a real regression look like the flake we already learned to re-run.
    testTimeout: 20_000,
    // The same reasoning for `beforeEach`, which is where the jsdom and the MSW server
    // are actually built. A starved hook failing produces an error about the setup rather
    // than about the test, which is a worse trail to follow.
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "**/*.d.ts",
        // Test scaffolding, and the env/client singletons it stubs — they read
        // import.meta.env at module load and have no behaviour to cover.
        "src/test/**",
        "src/shared/lib/env.ts",
        "src/shared/api/supabase.ts",
        "src/shared/lib/clock.ts",
        // Playwright's job, not jsdom's (§13.2). These are the auth front door and the
        // shell that composes it: "sign up → sign in → sign out" is an E2E flow against
        // real Supabase, and a jsdom test of them would assert that a mocked SDK returned
        // what the mock was told to return. Excluded rather than left to drag the number
        // down, so the percentage describes code this level can actually cover.
        //
        // Note this is deliberately *not* all of src/app: TodayScreen lives there because
        // features may not import each other (§2.2 rule 6) and the route is what joins
        // focus to friction. It has real behaviour and is tested.
        "src/app/App.tsx",
        "src/app/providers.tsx",
        "src/features/auth/ui/**",
        "src/features/auth/api/use-supabase-session.ts",
        // `Shell.tsx` is the code that used to be *inside* App.tsx — the bar, the nav, and the
        // session gate — carved out in M2 because the root route has to render it. It kept the
        // exclusion with the code; leaving it counted at 0% because of where a refactor moved it
        // would have been an accident rather than a decision.
        "src/app/Shell.tsx",
        // The route tree is `createRoute` calls. A jsdom test would assert that they return routes;
        // whether the paths are right is what the E2E suite's URL assertions check.
        "src/app/router.tsx",
      ],
      thresholds: {
        // §13.1 per-area, with a global floor over what remains after the E2E-owned
        // files are excluded above.
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
        "src/features/*/api/**": { lines: 85, branches: 75 },
        "src/features/*/model/**": { lines: 85, branches: 75 },
        "src/shared/ui/**": { lines: 80, branches: 70 },
      },
    },
  },
});
