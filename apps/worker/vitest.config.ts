import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Workspace packages resolve to source, not to their built `dist`. Node and the
  // production bundle use dist; a test suite that read dist would pass against
  // whatever was built last, so an edit to packages/core would appear to do
  // nothing until someone rebuilt it.
  resolve: {
    alias: {
      "@mindforge/core": pkg("core"),
      "@mindforge/db": pkg("db"),
      "@mindforge/llm": pkg("llm"),
      "@mindforge/workspace": pkg("workspace"),
    },
  },
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.ts",
        "src/main.tsx",
        "**/*.module.ts",
        // Composition and adapters. `infrastructure/` is Prisma queries and `presentation/` is the
        // timer loop — both are proved by running them, not by a double, and the same split is what
        // apps/api's two configs do. Neither has an integration harness here yet; see the note below.
        "src/shared/**",
        "src/modules/*/infrastructure/**",
        "src/modules/*/presentation/**",
      ],
      // Until M2 this block had no `thresholds` key at all, so the worker was measured at 0% and
      // passed — `passWithNoTests` plus no floor means new code here is gated by nothing. The
      // numbers match apps/api's application layer, because that is what this is.
      //
      // What is NOT covered and is worth knowing: `PrismaNightlyGateway` and `NightlyScheduler`
      // have no tests, because the worker has no integration config and is not in CI's integration
      // job. §13.2 wants a queue harness; the honest version of that arrives with Redis. Until
      // then the gateway is exercised only by running the worker, which is a real gap rather than
      // a decision.
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
