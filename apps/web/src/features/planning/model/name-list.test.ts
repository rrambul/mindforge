import { describe, expect, it } from "vitest";
import { formatNameList } from "./name-list.js";

describe("formatNameList", () => {
  it("joins the last two with the locale's own conjunction", () => {
    // `join(", ")` is the version that looks right in a code review and is wrong in every locale the
    // app ships.
    expect(formatNameList(["Rust", "Go", "Elm"], "en")).toBe("Rust, Go, and Elm");
    expect(formatNameList(["Rust", "Go", "Elm"], "pt-BR")).toBe("Rust, Go e Elm");
  });

  it("says a pair without a comma", () => {
    expect(formatNameList(["Rust", "Go"], "en")).toBe("Rust and Go");
  });

  it("leaves one name alone", () => {
    expect(formatNameList(["Rust"], "en")).toBe("Rust");
  });

  it("returns the same answer on the cached second call", () => {
    // The formatter is memoised per locale, so a stale entry would show up as the wrong separator on
    // every render after the first.
    expect(formatNameList(["Rust", "Go"], "pt-BR")).toBe("Rust e Go");
    expect(formatNameList(["Rust", "Go"], "pt-BR")).toBe("Rust e Go");
  });
});
