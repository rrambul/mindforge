import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts", "src/**/ports.ts"],
      // Not the 100% packages/core is held to. These are parsers over a format
      // somebody else controls, and most of their branches are warnings about
      // input this repo cannot produce on purpose — the honest bar is that
      // every warning branch has a fixture, which is what these numbers buy.
      // See TECH-DESIGN.md §13.1.
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
    },
  },
});
