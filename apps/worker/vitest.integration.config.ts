import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * The worker against the real stack.
 *
 * `vitest.config.ts` excludes `infrastructure/**` from coverage on the grounds
 * that adapters are proved by running them rather than by a double — and until
 * M3 nothing ran them, which that file called "a real gap rather than a
 * decision". This is the gate that closes it.
 *
 * Needs `supabase start` **with Storage**, which is also why CI stopped excluding
 * it. The one thing a double cannot check is the part most likely to be wrong:
 * that `list()` is not recursive, that neither `download()` nor `upload()`
 * carries an ETag, and that a directory in a listing is an entry with a null id.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@mindforge/core": pkg("core"),
      "@mindforge/db": pkg("db"),
      "@mindforge/llm": pkg("llm"),
      "@mindforge/workspace": pkg("workspace"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    // One Storage bucket, shared. Parallel files would race each other's prefixes.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Scoped to `teach`, not to every module's infrastructure, and two files
      // inside it are named out rather than counted.
      //
      // `modules/nightly/infrastructure/prisma-nightly.gateway.ts` has no
      // integration test and is not covered by this suite. Widening the include to
      // reach it and then lowering the threshold until it passed would report a
      // number instead of a gap — so it stays out, and stays named: it is the
      // remaining half of what `vitest.config.ts` calls "a real gap rather than a
      // decision", and it closes when someone writes the test rather than when
      // someone edits this line.
      //
      // `agent-sdk.gateway.ts` is out for a different reason, and a permanent one:
      // the only way to exercise it is to call the Anthropic Agent SDK, and
      // non-negotiable 8 forbids a live API call in the suites. What exercises it
      // is `scripts/teach-probe.ts`, run by hand against a real key — and that is
      // not a lesser substitute here, it is the thing that found every SDK fact in
      // CLAUDE.md's "facts that bite" list, each of which fails *silently* and none
      // of which a double would have reproduced. It sat inside the include at 11%
      // dragging the whole gate below its floor, which reported "the teach adapters
      // are 58% covered" when the two that can be tested are now at 93% and 100%.
      //
      // If someone wants a number for it: `translate()` is pure — an `SDKMessage`
      // in, an `AgentEvent` out — and extracting it would be genuinely worth unit
      // testing, because message shapes are exactly what the SDK changes.
      include: ["src/modules/teach/infrastructure/**"],
      exclude: ["src/modules/teach/infrastructure/agent-sdk.gateway.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
