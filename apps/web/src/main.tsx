import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { applyTheme, storedTheme } from "./shared/lib/theme.js";
import "./shared/ui/styles/base.css";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Before the first paint, not in an effect: React would otherwise render the light
// ground for a frame and then swap, which reads as a flash on every load in dark mode.
applyTheme(storedTheme());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
