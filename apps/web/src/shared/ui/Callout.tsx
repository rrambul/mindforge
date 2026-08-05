import type { ReactNode } from "react";
import "./styles/callout.css";

interface CalloutProps {
  readonly tone?: "neutral" | "warning" | "danger";
  /** Announced when it appears. True for anything reporting a failed action. */
  readonly live?: boolean;
  readonly children: ReactNode;
}

/**
 * How the app says something plainly, once.
 *
 * There is no `success` tone, deliberately. Confirming that a thing you asked for happened is the
 * celebratory copy NORTHSTAR.md §3 rules out — the honest confirmation is the screen showing the new
 * state.
 */
export function Callout({ tone = "neutral", live = false, children }: CalloutProps) {
  return (
    <div className="mf-callout" data-tone={tone} {...(live ? { role: "alert" } : {})}>
      {children}
    </div>
  );
}
