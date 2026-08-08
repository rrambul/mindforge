import { describe, expect, it } from "vitest";
import { resolveTheme } from "./profile.js";

describe("resolveTheme", () => {
  it("keeps a theme this build ships", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("degrades a theme it does not recognise rather than throwing", () => {
    // The column is free text with no check constraint, and the SPA reads the theme before it
    // paints — one bad row must not be able to lock a user out of their own interface.
    expect(resolveTheme("solarized")).toBe("light");
    expect(resolveTheme("")).toBe("light");
    expect(resolveTheme(null)).toBe("light");
    expect(resolveTheme(undefined)).toBe("light");
  });
});
