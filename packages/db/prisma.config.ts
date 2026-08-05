import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env. Node 22 does it natively.
try {
  process.loadEnvFile(".env");
} catch {
  // Expected in CI and on Railway, where the environment is already populated.
}

const directUrl = process.env["DIRECT_URL"];

/**
 * Migration-time configuration only.
 *
 * `datasource.url` is used by the Prisma CLI (migrate, introspect) and must be
 * the DIRECT connection — migrations cannot run through pgbouncer. The runtime
 * client is constructed separately with the pooled DATABASE_URL.
 * See TECH-DESIGN.md §14.
 *
 * The datasource is included only when DIRECT_URL is present. `prisma generate`
 * needs no database, and CI runs it without one — using prisma/config's `env()`
 * here would throw during install. Omitting the key instead means a genuine
 * migration against a missing URL still fails loudly, with Prisma's own error,
 * rather than silently connecting to a placeholder.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Required to use migrations.initShadowDb. We are not declaring external
  // tables — we only need the shadow-DB bootstrap that flag gates.
  experimental: {
    externalTables: true,
  },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
  migrations: {
    path: "prisma/migrations",
    // Supabase's auth schema does not exist in Prisma's throwaway shadow DB,
    // and our RLS policies reference auth.uid(). Stub it for diffing only.
    initShadowDb: "prisma/shadow-init.sql",
    seed: "tsx scripts/seed-minimal.ts",
  },
});
