import type { ReactNode } from "react";

interface CalloutProps {
  readonly tone?: "neutral" | "warning" | "danger";
  /** Announced when it appears. True for anything that reports a failed action. */
  readonly live?: boolean;
  readonly children: ReactNode;
}

const CLASS = {
  neutral: "mf-callout",
  warning: "mf-callout mf-callout--warning",
  danger: "mf-callout mf-callout--danger",
} as const;

/**
 * How the app says something plainly, once.
 *
 * Tones are `warning` and `danger` only — there is no `success`. Confirming that a
 * thing you asked for happened is the celebratory copy NORTHSTAR.md §3 rules out, and
 * the honest confirmation is the screen showing the new state.
 */
export function Callout({ tone = "neutral", live = false, children }: CalloutProps) {
  return (
    <div className={CLASS[tone]} {...(live ? { role: "alert" } : {})}>
      {children}
    </div>
  );
}
