/**
 * Database access. Prisma lives here and nowhere else — domain and application
 * layers depend on repository interfaces, never on @prisma/client.
 * See TECH-DESIGN.md §2.1, §3.6.
 */
export { withRls, type PrismaLike, type RlsClaims } from "./rls.js";
