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
