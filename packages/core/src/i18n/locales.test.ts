import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  defaultWeekStartsOn,
  isLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locales.js";

describe("isLocale", () => {
  it("accepts every locale we ship", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("rejects a locale we don't ship", () => {
    expect(isLocale("fr")).toBe(false);
  });

  it("rejects a differently-cased spelling of a locale we do ship", () => {
    // Deliberately strict: this is the guard used to validate what goes *into*
    // the database, and two spellings of the same locale in a column is how a
    // `Record<Locale, …>` lookup starts returning undefined at runtime.
    expect(isLocale("pt-br")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("resolveLocale", () => {
  it("passes through an exact match", () => {
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("en")).toBe("en");
  });

  it("normalizes the separator and casing that arrive in practice", () => {
    expect(resolveLocale("pt_BR")).toBe("pt-BR");
    expect(resolveLocale("PT-br")).toBe("pt-BR");
    expect(resolveLocale("  pt-BR  ")).toBe("pt-BR");
  });

  it("resolves a bare language subtag to the variant we ship", () => {
    expect(resolveLocale("pt")).toBe("pt-BR");
  });

  it("prefers the wrong region of a language we ship over English", () => {
    // A European Portuguese speaker is far better served by pt-BR than by en.
    expect(resolveLocale("pt-PT")).toBe("pt-BR");
  });

  it("falls back rather than throwing on anything unrecognised", () => {
    // Load-bearing: a profile row with a locale we dropped must still be able
    // to render an error page. Throwing here would 500 every request that user
    // makes, including the one that would let them fix the setting.
    expect(resolveLocale("fr-CA")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("klingon")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("   ")).toBe(DEFAULT_LOCALE);
  });
});

describe("defaultWeekStartsOn", () => {
  it("starts the Brazilian week on Sunday and the English week on Monday", () => {
    expect(defaultWeekStartsOn("pt-BR")).toBe(0);
    expect(defaultWeekStartsOn("en")).toBe(1);
  });

  it("returns a value for every locale we ship", () => {
    // The weekly plan grid indexes on this. A locale added without a week start
    // would produce `undefined` columns rather than a compile error.
    for (const locale of SUPPORTED_LOCALES) {
      expect([0, 1]).toContain(defaultWeekStartsOn(locale));
    }
  });
});
