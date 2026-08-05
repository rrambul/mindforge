import { createPrismaClient, type PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApp } from "../../src/bootstrap.js";

/**
 * Helpers for driving the real stack.
 *
 * No mocks at the boundary (§13.2): a real Nest app with its real DI graph, real
 * Postgres, and real Supabase Auth issuing real ES256 tokens. That is the only way
 * to test the parts most likely to be wrong — whether the JWKS verifier accepts a
 * genuine token, and whether RLS actually isolates through the whole request path.
 */

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly accessToken: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run \`supabase start\` and check .env.local.`);
  }
  return value;
}

export function adminDb(): PrismaClient {
  return createPrismaClient(requireEnv("DIRECT_URL"));
}

export function bootApp(): Promise<NestFastifyApplication> {
  return createApp().then(async (app) => {
    // Fastify routes are only resolvable after init; `inject` needs that too.
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  });
}

interface SignUpResponse {
  access_token?: string;
  user?: { id?: string };
  msg?: string;
  error_description?: string;
}

/**
 * Signs a user up through Supabase Auth, which is what makes the token real.
 *
 * A hand-minted JWT would prove nothing about the verifier: the whole point of the
 * guard is that it checks a signature against Supabase's published keys, and a token
 * we signed ourselves would either be rejected (and the test would be about our
 * signing) or accepted for the wrong reason.
 *
 * `supabase/config.toml` disables email confirmation locally, so signup returns a
 * session immediately.
 */
export async function signUp(): Promise<TestUser> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  // Unique per call, so a suite can create several users and a failed run leaves
  // nothing that makes the next run fail for the wrong reason.
  const email = `it-${crypto.randomUUID()}@mindforge.test`;
  const password = `pw-${crypto.randomUUID()}`;

  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as SignUpResponse;
  if (!response.ok || !body.access_token || !body.user?.id) {
    throw new Error(
      `Supabase signup failed (${response.status}): ${body.msg ?? body.error_description ?? JSON.stringify(body)}`,
    );
  }

  return { id: body.user.id, email, accessToken: body.access_token };
}

/** Cascades through profiles to every owned row (FR-A4). */
export async function deleteUsers(db: PrismaClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.$executeRawUnsafe(`delete from auth.users where id = any($1::uuid[])`, [...ids]);
}

export function bearer(user: TestUser): Record<string, string> {
  return { authorization: `Bearer ${user.accessToken}` };
}
