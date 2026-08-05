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

  PORT: z.coerce.number().int().positive().default(3000),

  /** The SPA's origin, for CORS. */
  APP_ORIGIN: z.url().default("http://localhost:5173"),

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
