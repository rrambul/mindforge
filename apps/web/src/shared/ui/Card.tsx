import type { ReactNode } from "react";
import "./styles/card.css";

interface CardProps {
  /**
   * `muted` is for something set aside — a parked mission. Dimmer, not hidden: parked knowledge is
   * still knowledge (§5.3), and hiding it would be the app deciding it no longer counts.
   */
  readonly variant?: "raised" | "muted";
  readonly as?: "article" | "section" | "div";
  readonly label?: string;
  readonly children: ReactNode;
}

export function Card({ variant = "raised", as: Element = "div", label, children }: CardProps) {
  return (
    <Element className="mf-card" data-variant={variant} {...(label ? { "aria-label": label } : {})}>
      {children}
    </Element>
  );
}
