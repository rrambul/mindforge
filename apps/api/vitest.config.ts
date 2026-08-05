import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * Two projects, because the two levels have different costs and different
 * prerequisites (TECH-DESIGN.md §13.2).
 *
 * `unit` does no I/O and runs on save. `integration` needs a real Postgres and a
 * real Supabase Auth — `supabase start` — so it is not part of the coverage gate
 * yet: CI has no database, and a gate that cannot run is not a gate. Wiring a
 * Postgres service container into CI is tracked separately; until then the
 * coverage number honestly describes unit coverage only.
 */
export default defineConfig({
  // Workspace packages resolve to source, not to their built `dist`. Node uses
  // dist (that is what makes the API runnable at all), but a test suite that
  // reads dist passes against whatever was built last — so an edit to
  // packages/core would appear to have no effect until someone rebuilt it.
  resolve: {
    alias: {
      "@mindforge/core": pkg("core"),
      "@mindforge/db": pkg("db"),
      "@mindforge/llm": pkg("llm"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          environment: "node",
          // These share one database, so running files concurrently makes them
          // fight over the same rows — the classic source of a suite that passes
          // alone and fails together.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        // Declarative wiring and bootstraps — config, not laziness (§13.1).
        "src/main.ts",
        "src/bootstrap.ts",
        "**/*.module.ts",
        "**/*.d.ts",
        // Interfaces and DI tokens. A file with no runtime behaviour in the
        // denominator makes the percentage describe file layout, not tested logic.
        "src/shared/persistence/user-scoped-db.ts",
        // Verified against the real Supabase JWKS in the integration suite. A
        // unit test here would assert that jose had been called, which proves
        // nothing about whether a forged token is rejected.
        "src/shared/auth/token-verifier.ts",
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
        // Per-area, so the global number cannot be reached by testing the easy
        // parts while the rules go bare (§13.1).
        "src/modules/*/domain/**": { lines: 95, branches: 90 },
        "src/modules/*/application/**": { lines: 90, branches: 85 },
      },
    },
  },
});
