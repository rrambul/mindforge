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
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
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
