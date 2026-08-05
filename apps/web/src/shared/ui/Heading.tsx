import type { ReactNode } from "react";
import "./styles/text.css";

interface HeadingProps {
  readonly level: 1 | 2;
  readonly children: ReactNode;
}

/**
 * Display type. Level is semantic *and* visual on purpose — this app has no case for an h2 styled
 * as an h1, and separating the two would invite one.
 */
export function Heading({ level, children }: HeadingProps) {
  const Element = level === 1 ? "h1" : "h2";
  return (
    <Element className="mf-heading" data-level={level}>
      {children}
    </Element>
  );
}
