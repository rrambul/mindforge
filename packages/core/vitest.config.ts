import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
      // packages/core is held to 100%: a bug here is a silently wrong number,
      // not a crash. See TECH-DESIGN.md §13.1.
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 95 },
    },
  },
});
