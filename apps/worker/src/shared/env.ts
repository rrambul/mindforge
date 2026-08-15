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
const EnvSchema = z
  .object({
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
     * How a teach run authenticates.
     *
     * - `api_key` — an Anthropic API key, billed as API usage. The only mode that works anywhere the
     *   worker might be deployed, because a container has nobody logged in.
     * - `subscription` — the Claude Code login on this machine, billed to that plan instead. For local
     *   development and for a single-user install running on its owner's laptop, which is what
     *   Mindforge is until NORTHSTAR §5 says otherwise.
     *
     * **Explicit rather than inferred from whether a key is set.** Inferring means a deploy that loses
     * its key silently falls back to a mode with no credentials to find, and fails at the first agent
     * run rather than at boot — the failure `SUPABASE_URL` is required to avoid, one level down.
     */
    TEACH_AUTH: z.enum(["api_key", "subscription"]).default("api_key"),

    /**
     * Required in `api_key` mode and meaningless in `subscription` mode (§11 — the key exists only in
     * `api` and `worker`, never in the SPA bundle). Passed through the SDK's `env`, which **replaces**
     * rather than merges the subprocess environment, so the spread that carries it is load-bearing.
     */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

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

    /**
     * The learner's daily teaching budget in USD, or empty for no ceiling.
     *
     * **The worker never enforces it** — only `TeachRuns.request` does, and only
     * the API serves that. It is declared here because the worker boots the API's
     * `TeachModule` to reuse its use cases (§2.1 decision 2), so Nest constructs
     * `TeachSpend` in this container too and would resolve `undefined` from an env
     * that had never heard of the setting.
     *
     * The same reasoning as `MEMORY_STORAGE_CONFIG`, which is declared here for
     * exactly this reason. Keep the default identical to the API's: a divergence
     * would be invisible until somebody read a number off the wrong process.
     */
    TEACH_DAILY_BUDGET_USD: z.preprocess(
      (value) => (value === "" ? null : value),
      z.coerce.number().nonnegative().nullable().default(15),
    ),
  })
  .superRefine((env, ctx) => {
    // The pairing the enum cannot express on its own. Checked at boot so a
    // misconfigured deploy dies immediately rather than eight minutes into
    // somebody's first lesson.
    if (env.TEACH_AUTH === "api_key" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message:
          "required when TEACH_AUTH is api_key; set TEACH_AUTH=subscription to use the Claude Code login instead",
      });
    }
  });

export type Env = Readonly<z.infer<typeof EnvSchema>>;

export const ENV = Symbol("Env");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  // Names only — never the values. DATABASE_URL carries a password, and a worker's crash log is the
  // one place nobody thinks to redact.
  //
  // The one exception is a `custom` issue, whose message we wrote ourselves and which therefore
  // contains no input. Without it the guidance on TEACH_AUTH — that there is a second mode and how
  // to pick it — never reaches the person staring at the crash, which is the only moment they would
  // have read it.
  const missing = parsed.error.issues
    .map((issue) =>
      issue.code === "custom" ? `${issue.path.join(".")} (${issue.message})` : issue.path.join("."),
    )
    .join(", ");
  throw new Error(`Invalid environment. Check: ${missing}`);
}
