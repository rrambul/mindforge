import type { ReactNode } from "react";
import "./styles/layout.css";

type Gap = "tight" | "normal" | "loose";

interface StackProps {
  readonly gap?: Gap;
  readonly children: ReactNode;
}

/**
 * Vertical rhythm.
 *
 * Exists so no feature has to remember which spacing token a column of content uses. Three named
 * gaps rather than an arbitrary number: a scale you can hold in your head is a scale that stays
 * consistent, and a `gap` prop taking any token would drift back into ad-hoc spacing.
 */
export function Stack({ gap = "normal", children }: StackProps) {
  return (
    <div className="mf-stack" data-gap={gap}>
      {children}
    </div>
  );
}
