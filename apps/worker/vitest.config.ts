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
    },
  },
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.ts", "src/main.tsx", "**/*.module.ts"],
    },
  },
});
