import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./locales.js";
import {
  formatServerMessage,
  SERVER_MESSAGE_KEYS,
  serverMessageSource,
  type ServerMessageKey,
} from "./server-messages.js";

/**
 * Representative variables per key. Keys absent from this map take no
 * variables; the completeness test below formats every key, so a message that
 * grows a placeholder without an entry here fails loudly rather than rendering
 * the literal `{limit}` to a user.
 */
const SAMPLE_VARS: Partial<Record<ServerMessageKey, Record<string, string | number>>> = {
  "error.mission.wip_limit": { limit: 3 },
  "error.resource.progress_out_of_range": { total: 590, unit: "page" },
};

describe("catalog completeness", () => {
  it("defines every key in every locale we ship", () => {
    // The type system already enforces this at compile time. The test exists
    // because `as const` widening or a future dynamic catalog would silently
    // remove that guarantee, and FR-L7 says a missing key fails the build.
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of SERVER_MESSAGE_KEYS) {
        expect(serverMessageSource(locale, key), `${locale} / ${key}`).toBeTruthy();
      }
    }
  });

  it("formats every catalogued message as a string", () => {
    // Proves the invariant `formatServerMessage` casts on: the catalog holds
    // plain text only, so ICU never returns a parts array. A rich-text message
    // added later fails here instead of stringifying as "[object Object]".
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of SERVER_MESSAGE_KEYS) {
        const out = formatServerMessage(locale, key, SAMPLE_VARS[key]);
        expect(typeof out, `${locale} / ${key}`).toBe("string");
        expect(out).not.toContain("{");
      }
    }
  });

  it("translates every message rather than sharing the English text", () => {
    // Catches the copy-paste that leaves an English string in the pt-BR block.
    for (const key of SERVER_MESSAGE_KEYS) {
      expect(serverMessageSource("pt-BR", key), key).not.toBe(serverMessageSource("en", key));
    }
  });
});

describe("error.resource.progress_out_of_range", () => {
  it("quotes the bound when there is one", () => {
    expect(
      formatServerMessage("en", "error.resource.progress_out_of_range", {
        total: 590,
        unit: "page",
      }),
    ).toContain("590");
  });

  it("does not invent a bound when the total is unknown", () => {
    // A resource whose length was never recorded has no end to quote, and "this has 0 pages" would be
    // both wrong and confusing about a book you are 137 pages into.
    const message = formatServerMessage("en", "error.resource.progress_out_of_range", {
      total: 0,
      unit: "page",
    });
    expect(message).not.toContain("0");
    expect(message).toBe("That position isn't valid.");
  });
});

describe("formatServerMessage", () => {
  it("keeps the 4xx fallback free of self-blame", () => {
    // error.internal says "Nothing you did caused this", which is false on a 413.
    // This key exists so the HTTP layer has something true to say about a 4xx.
    for (const locale of SUPPORTED_LOCALES) {
      const detail = formatServerMessage(locale, "error.bad_request");
      const internal = formatServerMessage(locale, "error.internal");
      expect(detail).not.toBe(internal);
    }
  });

  it("renders a message with no variables", () => {
    expect(formatServerMessage("en", "error.unauthenticated")).toBe("Sign in to continue.");
    expect(formatServerMessage("pt-BR", "error.unauthenticated")).toBe("Entre para continuar.");
  });

  it("applies ICU plural rules per locale", () => {
    expect(formatServerMessage("en", "error.mission.wip_limit", { limit: 3 })).toBe(
      "You have 3 active missions. Park one before starting another.",
    );
    expect(formatServerMessage("en", "error.mission.wip_limit", { limit: 1 })).toBe(
      "You have 1 active mission. Park one before starting another.",
    );
  });

  it("applies Portuguese plural rules, which are not English's", () => {
    expect(formatServerMessage("pt-BR", "error.mission.wip_limit", { limit: 3 })).toBe(
      "Você tem 3 missões ativas. Pause uma antes de começar outra.",
    );
    expect(formatServerMessage("pt-BR", "error.mission.wip_limit", { limit: 1 })).toBe(
      "Você tem 1 missão ativa. Pause uma antes de começar outra.",
    );
  });

  it("reuses the compiled formatter across calls", () => {
    // Not an optimisation detail for its own sake: compiling an ICU message
    // parses it, and doing that per request for a fixed catalog is waste on
    // every single error response.
    const first = formatServerMessage("en", "error.mission.wip_limit", { limit: 2 });
    const second = formatServerMessage("en", "error.mission.wip_limit", { limit: 4 });
    expect(first).toContain("2 active missions");
    expect(second).toContain("4 active missions");
  });

  it("treats an omitted vars argument the same as an empty one", () => {
    expect(formatServerMessage("en", "error.internal")).toBe(
      formatServerMessage("en", "error.internal", {}),
    );
  });
});
