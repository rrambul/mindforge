import type { ReactNode } from "react";
import { Label } from "./Text.js";
import "./styles/card.css";

interface CardSectionProps {
  /**
   * The block's caption, already translated. Omitted when the controls inside already name
   * themselves — a rule above a labelled field is separation enough, and a second caption saying
   * what the label says is noise.
   */
  readonly label?: string;
  readonly children: ReactNode;
}

/**
 * A block inside a card, set off by a hairline.
 *
 * The cards that need this are the ones carrying the most: a resource has a progress bar, a
 * position control, its mission and skill links, a note composer, and four actions, and `Card`'s
 * even gap gave all six the same weight — so a display fact and an editing control read as the same
 * kind of thing and the card became a wall to scan. The rule is the same hairline a goal's target
 * rows use, so this is the existing language rather than a new one.
 *
 * A `div` rather than a `section`: an unnamed `section` is a generic box to the accessibility tree
 * anyway, and the caption here is a `Label` span, which cannot name a region.
 */
export function CardSection({ label, children }: CardSectionProps) {
  return (
    <div className="mf-card__section">
      {label === undefined ? null : <Label>{label}</Label>}
      {children}
    </div>
  );
}
