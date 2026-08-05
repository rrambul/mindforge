import type { ReactNode } from "react";
import "./styles/text.css";

type Tone = "body" | "muted" | "hint";

interface TextProps {
  readonly tone?: Tone;
  readonly as?: "p" | "span";
  readonly children: ReactNode;
}

/**
 * Body copy at one of three weights of emphasis.
 *
 * `hint` is smaller and fainter — for the sentence under a field. `muted` is body-sized and quieter
 * — for the thing that is true but secondary. Keeping them distinct stops "make it grey" from
 * meaning two different sizes in two places.
 */
export function Text({ tone = "body", as: Element = "p", children }: TextProps) {
  return (
    <Element className="mf-text" data-tone={tone}>
      {children}
    </Element>
  );
}

/**
 * An uppercase, letter-spaced label. Not a `<label>` — see `Field` for that. This is for the caption
 * above a group, where there is no single control to point at.
 */
export function Label({ children }: { readonly children: ReactNode }) {
  return <span className="mf-label">{children}</span>;
}

/**
 * Numbers are the product's voice: always mono, always tabular.
 *
 * Tabular matters more than it sounds — a ticking timer in proportional digits reflows its own line
 * every second, which reads as instability in the one element you are watching.
 */
export function Figure({ children }: { readonly children: ReactNode }) {
  return <span className="mf-figure">{children}</span>;
}
