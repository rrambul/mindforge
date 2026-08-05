import type { ReactNode } from "react";
import "./styles/layout.css";

/**
 * Two things pushed apart, baseline-aligned — a heading and the figure that qualifies it.
 *
 * Baseline rather than centre, because the pairing is almost always type against type and centring
 * them makes a large number sit visibly high against its label.
 */
export function Spread({ children }: { readonly children: ReactNode }) {
  return <div className="mf-spread">{children}</div>;
}
