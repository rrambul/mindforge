import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.js";

/**
 * Prisma client construction.
 *
 * Prisma 7 removed the Rust query engine and with it `datasourceUrl` — the
 * connection is supplied by a driver adapter instead. That is why this factory
 * exists rather than callers doing `new PrismaClient()`: there is exactly one
 * place that knows how a connection is made.
 *
 * The pooled URL is used at runtime; migrations use DIRECT_URL via
 * prisma.config.ts. See TECH-DESIGN.md §14.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export { PrismaClient };
