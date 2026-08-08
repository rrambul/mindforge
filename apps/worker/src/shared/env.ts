import { z } from "zod";

/**
 * The worker's environment, validated once at boot.
 *
 * Still a smaller set than the API's: the worker serves no HTTP, verifies no tokens, and has no
 * CORS, so asking it for `APP_ORIGIN` would make it refuse to start over a setting it never reads —
 * the kind of thing that turns a deploy into an afternoon.
 *
 * **`SUPABASE_URL` arrived in M3 and the note above used to name it as an example of what not to
 * require.** That changed when the worker gained a reason to read it: teach workspaces live in
 * Storage (§7.2), and the worker is the only thing that touches them. It is required rather than
 * optional because a worker that boots without it fails at the first agent run instead of at
 * startup, which is the failure mode `REDIS_URL`'s absence exists to avoid.
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

  /** Storage lives here. Teach workspaces are the worker's only reason to know it (§7.2). */
  SUPABASE_URL: z.string().min(1),

  /**
   * Bypasses RLS, which is the point: the workspace bucket has no policies, so this key is the only
   * thing that can read it. Every path the worker builds is scoped by `user_id` in code, and that
   * hand-written scoping is the enforcement.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

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
