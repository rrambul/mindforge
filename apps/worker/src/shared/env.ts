import { z } from "zod";

/**
 * The worker's environment, validated once at boot.
 *
 * Deliberately a smaller set than the API's. The worker serves no HTTP, verifies no tokens, and has
 * no CORS — asking it for `SUPABASE_URL` or `APP_ORIGIN` would make it refuse to start over settings
 * it never reads, which is the kind of thing that turns a deploy into an afternoon.
 *
 * **`REDIS_URL` is deliberately absent.** It is in `.env.example` and TECH-DESIGN §2 names BullMQ as
 * the queue, but no Redis exists locally, in CI, or in any config in this repo, and `bullmq` is a
 * declared dependency that nothing imports. Requiring it here would stop the worker booting on every
 * machine there is. The scheduler below is written so that adding Redis later replaces the timer
 * without touching the jobs.
 */
const EnvSchema = z.object({
  /**
   * Pooled connection. The worker holds a connection that bypasses RLS by design (§3.6), which is
   * why every query it makes filters `user_id` by hand — CLAUDE.md's first non-negotiable.
   */
  DATABASE_URL: z.string().min(1),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * How often the scheduler wakes. Fifteen minutes is fine granularity for jobs whose triggers are
   * "the user's local day rolled over" and "it is the hour they asked to be reminded" — and it means
   * a zone offset of :45 (Kathmandu, Chatham) still lands in the right hour.
   */
  SCHEDULER_TICK_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(15 * 60 * 1_000),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

export const ENV = Symbol("Env");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  // Names only — never the values. DATABASE_URL carries a password, and a worker's crash log is the
  // one place nobody thinks to redact.
  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid environment. Check: ${missing}`);
}
