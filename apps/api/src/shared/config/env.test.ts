import { describe, expect, it } from "vitest";
import { loadEnv, supabaseIssuer, supabaseJwksUrl } from "./env.js";

const MINIMAL = {
  DATABASE_URL: "postgresql://postgres:hunter2@127.0.0.1:54322/postgres",
  SUPABASE_URL: "http://127.0.0.1:54321",
  // Required since M3: deleting a learner memory has to delete its file, and the
  // workspace bucket has no policies, so only the service role can reach it.
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  // Required since M5: the API signs the grants apps/lessons verifies (FR-T5),
  // and a default here would be a secret in the repository that every deployment
  // forgetting to set one would silently share.
  LESSONS_TOKEN_SECRET: "lessons-token-secret",
} satisfies NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("accepts a minimal environment and applies the documented defaults", () => {
    const env = loadEnv(MINIMAL);
    expect(env.PORT).toBe(3000);
    expect(env.APP_ORIGIN).toBe("http://localhost:5173");
    expect(env.LESSONS_ORIGIN).toBe("http://localhost:3001");
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces PORT, which arrives as a string from every real environment", () => {
    expect(loadEnv({ ...MINIMAL, PORT: "8080" }).PORT).toBe(8080);
  });

  it("names the missing variable rather than failing on the first request", () => {
    // The failure this prevents: without SUPABASE_URL the guard cannot fetch a
    // JWKS, and every authenticated request 401s with nothing in the log to say
    // why. Fail at boot, with the name.
    expect(() => loadEnv({ DATABASE_URL: MINIMAL.DATABASE_URL })).toThrow(/SUPABASE_URL/);
  });

  it("never echoes a value, because DATABASE_URL carries a password", () => {
    let message = "";
    try {
      loadEnv({ ...MINIMAL, SUPABASE_URL: "not-a-url" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("SUPABASE_URL");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("not-a-url");
  });

  it("refuses to boot without the secret the lessons origin verifies", () => {
    // A lessons service with the wrong secret 404s every lesson and looks, in the
    // logs, exactly like a learner whose content has gone missing.
    const withoutSecret: NodeJS.ProcessEnv = { ...MINIMAL };
    delete withoutSecret["LESSONS_TOKEN_SECRET"];

    expect(() => loadEnv(withoutSecret)).toThrow(/LESSONS_TOKEN_SECRET/);
  });

  it("rejects a port that cannot be one", () => {
    expect(() => loadEnv({ ...MINIMAL, PORT: "0" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...MINIMAL, PORT: "not-a-number" })).toThrow(/PORT/);
  });

  it("rejects an unknown NODE_ENV instead of quietly treating it as production", () => {
    expect(() => loadEnv({ ...MINIMAL, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

describe("TEACH_DAILY_BUDGET_USD", () => {
  it("defaults to a ceiling generous enough that a real learner never meets it", () => {
    expect(loadEnv(MINIMAL).TEACH_DAILY_BUDGET_USD).toBe(15);
  });

  it("coerces the string every real environment supplies", () => {
    expect(loadEnv({ ...MINIMAL, TEACH_DAILY_BUDGET_USD: "40" }).TEACH_DAILY_BUDGET_USD).toBe(40);
  });

  it("reads empty as no ceiling, not as a ceiling of zero", () => {
    // The trap this exists for: `z.coerce.number()` turns "" into 0, which is the
    // one value that switches teaching off. A deployment clearing the variable
    // means "no cap" and would have got "nobody may be taught anything".
    expect(loadEnv({ ...MINIMAL, TEACH_DAILY_BUDGET_USD: "" }).TEACH_DAILY_BUDGET_USD).toBeNull();
  });

  it("keeps zero meaning zero, because switching teaching off is a real setting", () => {
    expect(loadEnv({ ...MINIMAL, TEACH_DAILY_BUDGET_USD: "0" }).TEACH_DAILY_BUDGET_USD).toBe(0);
  });

  it("refuses a negative ceiling at boot rather than inverting the check", () => {
    expect(() => loadEnv({ ...MINIMAL, TEACH_DAILY_BUDGET_USD: "-5" })).toThrow(
      /TEACH_DAILY_BUDGET_USD/,
    );
  });

  it("refuses a value that is not a number at all", () => {
    expect(() => loadEnv({ ...MINIMAL, TEACH_DAILY_BUDGET_USD: "lots" })).toThrow(
      /TEACH_DAILY_BUDGET_USD/,
    );
  });
});

describe("supabase URL derivation", () => {
  it("derives the issuer from SUPABASE_URL, so it is never configured twice", () => {
    expect(supabaseIssuer(loadEnv(MINIMAL))).toBe("http://127.0.0.1:54321/auth/v1");
  });

  it("tolerates a trailing slash", () => {
    // Copy-pasted from a Supabase dashboard, this is how the value usually
    // arrives. A doubled slash in the issuer makes every token fail the issuer
    // check with no useful error.
    const env = loadEnv({ ...MINIMAL, SUPABASE_URL: "https://abc.supabase.co/" });
    expect(supabaseIssuer(env)).toBe("https://abc.supabase.co/auth/v1");
  });

  it("points at the standard JWKS path", () => {
    expect(supabaseJwksUrl(loadEnv(MINIMAL)).toString()).toBe(
      "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json",
    );
  });
});
