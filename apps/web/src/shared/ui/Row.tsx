import type { ReactNode } from "react";
import "./styles/layout.css";

interface RowProps {
  /** Lets short fields share a line and wrap on a narrow screen rather than shrink. */
  readonly fill?: boolean;
  readonly children: ReactNode;
}

/**
 * Horizontal group that wraps.
 *
 * Wrapping rather than shrinking is the point: a control squeezed below 44px stops being tappable,
 * and §5.1 names the friction chips as the ones most likely to be drawn too small.
 */
export function Row({ fill = false, children }: RowProps) {
  return (
    <div className="mf-row" data-fill={fill ? "true" : undefined}>
      {children}
    </div>
  );
}
