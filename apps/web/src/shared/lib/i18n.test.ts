import { DEFAULT_LOCALE } from "@mindforge/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDocumentLocale, createI18n, guessLocaleFromBrowser } from "./i18n.js";

function withLanguages(languages: string[]): void {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("guessLocaleFromBrowser", () => {
  it("picks a supported locale from the browser's preferences", () => {
    withLanguages(["pt-BR", "en-US"]);
    expect(guessLocaleFromBrowser()).toBe("pt-BR");
  });

  it("skips languages we don't ship and takes the first we do", () => {
    withLanguages(["fr-FR", "de", "pt"]);
    expect(guessLocaleFromBrowser()).toBe("pt-BR");
  });

  it("returns English when English is preferred", () => {
    withLanguages(["en-GB"]);
    expect(guessLocaleFromBrowser()).toBe("en");
  });

  it("falls back when nothing matches", () => {
    withLanguages(["fr", "de"]);
    expect(guessLocaleFromBrowser()).toBe(DEFAULT_LOCALE);
  });
});

describe("applyDocumentLocale", () => {
  it("sets lang and dir on <html>, which fixes hyphenation and screen-reader voice", () => {
    applyDocumentLocale("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("createI18n", () => {
  it("renders ICU plurals under each locale's own rules", async () => {
    // The same ICU syntax the server-side bundle uses, so a string can move between the
    // two halves without being rewritten.
    const en = createI18n("en");
    await en.loadNamespaces("missions");
    expect(en.t("missions:wip.full", { limit: 1 })).toContain("1 active mission.");
    expect(en.t("missions:wip.full", { limit: 3 })).toContain("3 active missions.");

    const pt = createI18n("pt-BR");
    await pt.loadNamespaces("missions");
    expect(pt.t("missions:wip.full", { limit: 1 })).toContain("1 missão ativa");
    expect(pt.t("missions:wip.full", { limit: 3 })).toContain("3 missões ativas");
  });

  it("does not escape apostrophes, which appear in real English copy", () => {
    // i18next's own escaping would turn "You're" into "You&#39;re" in a React tree that
    // already escapes.
    const en = createI18n("en");
    expect(en.t("missions:empty.body")).toContain("you're");
  });

  it("translates the domain glossary rather than each usage", () => {
    // §5.2: the vocabulary is translated once, in one file, or the same term ends up
    // rendered three ways across three screens.
    const pt = createI18n("pt-BR");
    expect(pt.t("glossary:ember")).toBe("Brasa");
    expect(pt.t("glossary:slag")).toBe("Escória");
    expect(pt.t("glossary:missionStatus.parked")).toBe("Pausada");
  });
});
