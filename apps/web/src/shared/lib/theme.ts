import { useEffect, useState } from "react";

/**
 * Light is the default ground by product decision, not by OS preference — see
 * design/tokens.css. So this deliberately does **not** read
 * `prefers-color-scheme`: the palette is derived from tempered-steel oxide colours and
 * the light version is the designed one.
 */
export type Theme = "light" | "dark";

const STORAGE_KEY = "mindforge.theme";

export function storedTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  // The token file keys off `:root[data-theme]`, and sets both branches explicitly so
  // the attribute always wins over the bare `:root` defaults.
  document.documentElement.dataset["theme"] = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
