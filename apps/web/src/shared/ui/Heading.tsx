import type { ReactNode } from "react";
import "./styles/text.css";

interface HeadingProps {
  readonly level: 1 | 2 | 3;
  readonly children: ReactNode;
}

/**
 * Display type. Level is semantic *and* visual on purpose — this app has no case for an h2 styled
 * as an h1, and separating the two would invite one.
 *
 * Level 3 arrived with the learning records (M5), which are cards inside a section that already has
 * an h2. Skipping to h2 there would leave two sibling h2s where one contains the other, which is
 * what a screen reader's heading list is for noticing.
 */
const ELEMENTS = { 1: "h1", 2: "h2", 3: "h3" } as const;

export function Heading({ level, children }: HeadingProps) {
  const Element = ELEMENTS[level];
  return (
    <Element className="mf-heading" data-level={level}>
      {children}
    </Element>
  );
}
