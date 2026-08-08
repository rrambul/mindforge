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
      // Scoped to `teach`, not to every module's infrastructure.
      //
      // `modules/nightly/infrastructure/prisma-nightly.gateway.ts` has no
      // integration test and is not covered by this suite. Widening the include to
      // reach it and then lowering the threshold until it passed would report a
      // number instead of a gap — so it stays out, and stays named: it is the
      // remaining half of what `vitest.config.ts` calls "a real gap rather than a
      // decision", and it closes when someone writes the test rather than when
      // someone edits this line.
      include: ["src/modules/teach/infrastructure/**"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
