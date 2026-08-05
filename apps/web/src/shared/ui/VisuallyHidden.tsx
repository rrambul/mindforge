import type { ReactNode } from "react";
import "./styles/text.css";

/**
 * Present for a screen reader, absent visually.
 *
 * Used where the visual grouping is obvious and the accessible name is not — the friction chip row
 * reads as one control to the eye and as eleven unlabelled buttons without this.
 */
export function VisuallyHidden({
  id,
  children,
}: {
  readonly id?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="mf-sr-only" {...(id ? { id } : {})}>
      {children}
    </span>
  );
}
