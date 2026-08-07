import type { ReactNode } from "react";
import "./styles/chip.css";

interface ChipListProps {
  /** Names the list for a screen reader, already translated. */
  readonly label: string;
  /** `<li>` elements, one per chip. */
  readonly children: ReactNode;
}

/**
 * A wrapping row of chips as a real list.
 *
 * Shared rather than feature-local because two features draw the same thing — a resource's mission
 * and skill links, and a skill's prerequisites — and until now both used a `mf-prereq-list` class
 * that only the *skills* stylesheet defined. It worked by accident: every feature's CSS lands in one
 * bundle, so the library screen was borrowing a class from a screen it never renders.
 */
export function ChipList({ label, children }: ChipListProps) {
  return (
    <ul className="mf-chip-list" aria-label={label}>
      {children}
    </ul>
  );
}
