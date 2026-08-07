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
  accent,
}: {
  readonly children: ReactNode;
  readonly live?: boolean;
  /**
   * Ember for the one status that means *in progress* — a resource you are reading, and nothing
   * else. It matches the colour of that resource's own progress fill, so the chip and the bar are
   * saying the same thing, and it makes the item you are actually on findable in a long list.
   *
   * Deliberately only this one value. Tinting `finished` green and `abandoned` grey would rank the
   * two, and FR-R5 is explicit that stopping is guilt-free — a palette that moralises about it would
   * push people back to leaving things `active` forever, which is worse data.
   */
  readonly accent?: "ember";
}) {
  return (
    <span
      className="mf-status-chip"
      {...(accent === undefined ? {} : { "data-accent": accent })}
      {...(live ? { role: "status" } : {})}
    >
      {children}
    </span>
  );
}
