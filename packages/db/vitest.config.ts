import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration only: these need the local Postgres from `supabase start`.
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
