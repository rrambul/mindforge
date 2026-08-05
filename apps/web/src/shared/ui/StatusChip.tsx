import type { ReactNode } from "react";
import "./styles/chip.css";

/**
 * A read-only badge — a mission's status, a pending count.
 *
 * Distinct from `ChoiceGroup`'s chips, which are buttons. They look similar by design (both are
 * small bordered rectangles) and behave completely differently, so they are separate components:
 * one is information, the other is a control, and a badge that looked tappable would be a lie.
 */
export function StatusChip({
  children,
  live = false,
}: {
  readonly children: ReactNode;
  readonly live?: boolean;
}) {
  return (
    <span className="mf-status-chip" {...(live ? { role: "status" } : {})}>
      {children}
    </span>
  );
}
