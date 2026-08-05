import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, storedTheme, useTheme } from "./theme.js";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("storedTheme", () => {
  it("defaults to light, by product decision rather than OS preference", () => {
    // tokens.css: light is the designed ground. Reading prefers-color-scheme here would
    // hand that decision to the operating system.
    expect(storedTheme()).toBe("light");
  });

  it("reads a stored choice back", () => {
    applyTheme("dark");
    expect(storedTheme()).toBe("dark");
  });

  it("treats an unrecognised stored value as light", () => {
    localStorage.setItem("mindforge.theme", "solarized");
    expect(storedTheme()).toBe("light");
  });
});

describe("applyTheme", () => {
  it("sets the attribute the tokens key off", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("persists, so a reload does not flash the other theme", () => {
    applyTheme("dark");
    expect(localStorage.getItem("mindforge.theme")).toBe("dark");
    applyTheme("light");
    expect(localStorage.getItem("mindforge.theme")).toBe("light");
  });
});

describe("useTheme", () => {
  it("starts from the stored choice and flips on toggle", async () => {
    applyTheme("dark");
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");

    act(() => {
      result.current.toggle();
    });
    await waitFor(() => expect(document.documentElement.dataset["theme"]).toBe("light"));
    expect(result.current.theme).toBe("light");
  });

  it("writes the attribute on mount, not only on change", async () => {
    // Otherwise a reload in dark mode paints the light ground for a frame.
    applyTheme("dark");
    delete document.documentElement.dataset["theme"];
    renderHook(() => useTheme());
    await waitFor(() => expect(document.documentElement.dataset["theme"]).toBe("dark"));
  });
});
