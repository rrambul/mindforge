import { Inject, Injectable } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ENV, supabaseIssuer, supabaseJwksUrl, type Env } from "../config/env.js";

export interface VerifiedToken {
  /** The `sub` claim. Always a uuid, because it is `auth.users.id`. */
  readonly userId: string;
}

/**
 * A port, so the guard's own logic is testable without a network round trip or a
 * signing key. The adapter below is the only thing that talks to Supabase.
 */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export const TOKEN_VERIFIER = Symbol("TokenVerifier");

/** `sub` lands in a uuid column, so a malformed one must be rejected here. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Verifies against Supabase's JWKS.
 *
 * The API never issues tokens and never holds a signing secret (TECH-DESIGN.md
 * §4) — it checks a signature against published public keys. `createRemoteJWKSet`
 * caches the key set and refetches on an unknown `kid`, so a key rotation is
 * handled without a deploy and without a thundering herd.
 *
 * `issuer` and `audience` are asserted, not merely decoded: a correctly-signed
 * token from a *different* Supabase project would otherwise authenticate here.
 */
@Injectable()
export class SupabaseJwtVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(@Inject(ENV) env: Env) {
    this.jwks = createRemoteJWKSet(supabaseJwksUrl(env));
    this.issuer = supabaseIssuer(env);
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: "authenticated",
    });

    const sub = payload.sub;
    if (typeof sub !== "string" || !UUID.test(sub)) {
      throw new Error("Token subject is not a uuid");
    }
    return { userId: sub };
  }
}
