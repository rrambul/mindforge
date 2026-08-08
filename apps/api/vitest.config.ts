import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Workspace packages resolve to source, not to their built `dist`.
 *
 * Node and the production build read `dist` — that is what makes the API runnable at
 * all. A suite that read `dist` would pass against whatever was built last, so an
 * edit to packages/core would appear to do nothing until someone rebuilt it.
 *
 * An alias rather than the `development` export condition, because Vite resolves
 * conditions differently per mode and an alias does not. Repeated in the integration
 * config rather than shared from a third file: config files are outside the tsconfig
 * project, so a shared helper would need its own lint exemption to buy four lines.
 */
const workspaceAliases = {
  "@mindforge/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
  "@mindforge/db": fileURLToPath(new URL("../../packages/db/src/index.ts", import.meta.url)),
  "@mindforge/llm": fileURLToPath(new URL("../../packages/llm/src/index.ts", import.meta.url)),
  "@mindforge/workspace": fileURLToPath(
    new URL("../../packages/workspace/src/index.ts", import.meta.url),
  ),
};

/**
 * The unit gate: no I/O, no database, no network (TECH-DESIGN.md §13.2). Fast enough
 * to run on save.
 *
 * `infrastructure/` and `presentation/` are outside its denominator on purpose.
 * §13.1 assigns them to integration tests against real Postgres, and counting them
 * here would reward unit-testing a Prisma mapper against a mock — which proves that
 * the mock was called, not that the SQL is right. They are gated by
 * `vitest.integration.config.ts` instead, so neither layer is ungated; they are just
 * measured by the level that can actually cover them.
 */
export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    name: "unit",
    include: ["src/**/*.test.ts"],
    environment: "node",
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
        // Interfaces and DI tokens: no runtime behaviour to cover, and counting
        // them makes the percentage describe file layout rather than tested logic.
        "src/shared/persistence/user-scoped-db.ts",
        // Verified against the real Supabase JWKS in the integration suite. A unit
        // test here would assert that jose had been called, which proves nothing
        // about whether a forged token is rejected.
        "src/shared/auth/token-verifier.ts",
        // Integration-tested — see the note above.
        "src/modules/*/infrastructure/**",
        "src/modules/*/presentation/**",
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
        // Per-area, so the global number cannot be reached by testing the easy parts
        // while the rules go bare (§13.1).
        "src/modules/*/domain/**": { lines: 95, branches: 90 },
        "src/modules/*/application/**": { lines: 90, branches: 85 },
      },
    },
  },
});
