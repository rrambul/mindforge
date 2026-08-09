import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

/**
 * The two ways a teach run can authenticate, and why the pairing is checked at
 * boot rather than discovered mid-run.
 */

function withoutApiKey(): Record<string, string> {
  const copy: Record<string, string> = { ...MINIMAL };
  delete copy["ANTHROPIC_API_KEY"];
  return copy;
}

const MINIMAL = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("TEACH_AUTH", () => {
  it("defaults to the API key, because that is the only mode a deploy can use", () => {
    // A container has nobody logged in. Defaulting the other way would make the
    // mode that cannot work in production the one you get by not choosing.
    expect(loadEnv(MINIMAL).TEACH_AUTH).toBe("api_key");
  });

  it("requires a key in api_key mode", () => {
    const withoutKey = withoutApiKey();

    expect(() => loadEnv(withoutKey)).toThrow(/ANTHROPIC_API_KEY/u);
  });

  it("says how to pick the other mode when the key is missing", () => {
    // The message is the documentation somebody actually reads: they are staring
    // at a crashed worker, not at env.ts.
    const withoutKey = withoutApiKey();

    expect(() => loadEnv(withoutKey)).toThrow(/TEACH_AUTH/u);
  });

  it("needs no key in subscription mode", () => {
    // The point of the mode: run lessons against the Claude Code login on this
    // machine, with no API key anywhere.
    const withoutKey = withoutApiKey();

    const env = loadEnv({ ...withoutKey, TEACH_AUTH: "subscription" });

    expect(env.TEACH_AUTH).toBe("subscription");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("tolerates a key that is set but unused in subscription mode", () => {
    // A developer switching modes should not have to unset anything — the mode
    // decides, not the presence of a variable.
    expect(loadEnv({ ...MINIMAL, TEACH_AUTH: "subscription" }).TEACH_AUTH).toBe("subscription");
  });

  it("refuses a mode nothing knows how to authenticate with", () => {
    expect(() => loadEnv({ ...MINIMAL, TEACH_AUTH: "oauth" })).toThrow(/TEACH_AUTH/u);
  });

  it("names only the failing variable, never its value", () => {
    // `DATABASE_URL` carries a password and a worker's crash log is the one place
    // nobody thinks to redact.
    let message = "";
    try {
      loadEnv({ ...MINIMAL, DATABASE_URL: "" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("postgres:postgres");
  });
});
