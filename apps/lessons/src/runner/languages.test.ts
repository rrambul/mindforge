import { describe, expect, test } from "bun:test";

import { allowedLanguages, PAGE_LANGUAGES } from "./browser/languages.js";

/**
 * The gate that keeps a run under the policy it was meant for. The JavaScript
 * runner has `connect-src 'none'`; if it ran Python it would fail to start, and if
 * the Python page ran JavaScript that code would get the looser policy for nothing.
 */
describe("allowedLanguages", () => {
  test("the JavaScript page allows JavaScript and TypeScript, never Python", () => {
    const allowed = allowedLanguages(PAGE_LANGUAGES.javascript.join(" "));

    expect(allowed.has("javascript")).toBe(true);
    expect(allowed.has("typescript")).toBe(true);
    expect(allowed.has("python")).toBe(false);
  });

  test("the Python page allows Python alone", () => {
    expect([...allowedLanguages(PAGE_LANGUAGES.python.join(" "))]).toEqual(["python"]);
  });

  test("a missing or unknown tag allows nothing, rather than everything", () => {
    expect(allowedLanguages(null).size).toBe(0);
    expect(allowedLanguages(undefined).size).toBe(0);
    expect(allowedLanguages("cobol  ruby").size).toBe(0);
  });
});
