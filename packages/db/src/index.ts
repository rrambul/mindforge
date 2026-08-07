/**
 * Database access. Prisma lives here and nowhere else — domain and application
 * layers depend on repository interfaces, never on the generated client.
 * See TECH-DESIGN.md §2.1, §3.6.
 */
export { PrismaClient, createPrismaClient } from "./client.js";
export { claimsFor, runAsUser, type RlsClaims, type RlsTransaction } from "./rls.js";
export { rebuildDailyActivity, type RollupResult } from "./rollup.js";
