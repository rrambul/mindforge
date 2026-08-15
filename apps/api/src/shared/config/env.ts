import { z } from "zod";

/**
 * Environment, validated once at boot.
 *
 * The failure this prevents is specific: without SUPABASE_URL the auth guard
 * cannot fetch a JWKS, and the symptom is every authenticated request returning
 * 401 with nothing in the logs to say why. A missing variable should stop the
 * process at startup with the variable's name in the message.
 */
const EnvSchema = z.object({
  /** Pooled connection. Migrations use DIRECT_URL via prisma.config.ts. */
  DATABASE_URL: z.string().min(1),

  /** Base URL of the Supabase stack. Auth issuer and JWKS derive from it. */
  SUPABASE_URL: z.url(),

  /**
   * Bypasses RLS, and the API needs it for exactly one thing: removing the file
   * behind a memory the learner deleted (§7.6). The workspace bucket has no
   * policies, so nothing else can reach it — and the path this key is given
   * always comes from a row RLS already checked, never from a client.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  PORT: z.coerce.number().int().positive().default(3000),

  /** The SPA's origin, for CORS. */
  APP_ORIGIN: z.url().default("http://localhost:5173"),

  /**
   * Where lesson HTML is served from, and it **must** be a different host from
   * `APP_ORIGIN` or the isolation in §7.5 is decorative — a same-origin frame can
   * reach the app's Supabase session whatever the sandbox attribute says.
   *
   * Not asserted here: on one machine both are `localhost` on different ports,
   * which is a different origin and a perfectly good local setup, while in a
   * deployment they are different hosts. A check strict enough to catch the real
   * mistake would refuse the local one.
   */
  LESSONS_ORIGIN: z.url().default("http://localhost:3001"),

  /**
   * Shared with `apps/lessons`, which verifies the grants this signs (FR-T5).
   *
   * Required, with no development default. A default would be a secret in the
   * repository that every deployment forgetting to set one would silently share —
   * and holding it is enough to read any workspace by signing its prefix.
   */
  LESSONS_TOKEN_SECRET: z.string().min(1),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * How much the API says about itself.
   *
   * `info` is the floor that still answers "did this request arrive, whose was it,
   * and what did it cost" — the four questions a production incident starts with.
   * Turning it to `debug` also surfaces the 401s the problem filter deliberately
   * keeps quiet, which is what you want when sign-in is the thing that is broken.
   *
   * The levels are pino's, spelled out rather than typed as a string, so a typo is
   * a boot failure naming the variable instead of a logger that silently accepts
   * `verbose` and emits nothing.
   */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  /**
   * What one learner may spend on teaching in a day, in USD (FR-T8).
   *
   * A teach run costs $1.47–$2.50 and is one button press. `MAX_BUDGET_USD` inside
   * `teach-run.ts` bounds a *single* run, and the single-active-run index is per
   * *mission* — so before this existed, a learner with six missions had six runs'
   * worth in flight and no ceiling at all across a week. `llm_calls` recorded every
   * cent of it and nothing read the rows back.
   *
   * The default is deliberately generous rather than tight: six or so runs a day is
   * more than anyone learns from, so it bites runaway loops and pathological use
   * without ever being felt by a real learner. The day is the learner's own,
   * derived from their IANA timezone like every other day in this product (§5.2).
   *
   * **Empty means no ceiling, and that is different from zero.** `0` switches
   * teaching off; unset says nobody configured a limit, and the UI renders a
   * sentence rather than a bar. A large number standing in for "unlimited" would
   * render as a progress bar at 0%, which claims a measurement against a limit
   * that does not exist.
   */
  TEACH_DAILY_BUDGET_USD: z.preprocess(
    // Before coercion, because `z.coerce.number()` turns "" into 0 — so a
    // deployment that set the variable empty meaning "no cap" would silently get
    // the one value that switches teaching off entirely.
    (value) => (value === "" ? null : value),
    z.coerce.number().nonnegative().nullable().default(15),
  ),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

export const ENV = Symbol("Env");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  // Deliberately not a DomainError: nobody is making a request yet, and this
  // must read as an operator problem rather than a user-facing one. Names only —
  // never echo the values, since DATABASE_URL carries a password.
  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid environment. Check: ${missing}`);
}

/** Supabase signs tokens with this issuer and JWKS. Derived, never configured twice. */
export function supabaseIssuer(env: Env): string {
  return `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
}

export function supabaseJwksUrl(env: Env): URL {
  return new URL(`${supabaseIssuer(env)}/.well-known/jwks.json`);
}
