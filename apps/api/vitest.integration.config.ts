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
};

/**
 * The integration gate: real Postgres, real Supabase Auth, no mocks at the boundary
 * (TECH-DESIGN.md §13.2). Needs `supabase start`.
 *
 * A separate config rather than a second project because coverage is configured once
 * per Vitest run, and these two levels answer for different code. This one owns
 * `infrastructure/` and `presentation/` — the repository mappers and the controllers,
 * which §13.1 puts at 80/70 precisely because they are only meaningfully covered
 * against a real database.
 *
 * Runs in CI in its own job, which boots the local Supabase stack (see .github/workflows/ci.yml).
 * `pnpm test:coverage` still measures unit coverage only — these two levels answer for different
 * code, and merging their numbers would make both meaningless.
 */
export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    name: "integration",
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    // These share one database, so running files concurrently makes them fight over
    // the same rows — the classic source of a suite that passes alone and fails
    // together.
    fileParallelism: false,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Only the layers this level answers for. Including the whole app would report
      // the domain as under-covered here and over-covered there, and neither number
      // would mean anything.
      include: ["src/modules/*/infrastructure/**/*.ts", "src/modules/*/presentation/**/*.ts"],
      exclude: [
        "**/*.module.ts",
        "**/*.d.ts",
        // Test files, which `include` above otherwise sweeps up: a unit test living beside the class it
        // covers — `html-url-metadata.reader.test.ts` — is in `infrastructure/`, so its 380 lines were
        // counted as uncovered *production* code. That alone reported this suite at 72% when it is
        // really 89%, which is the sort of number that gets a threshold quietly lowered.
        "**/*.test.ts",
      ],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
