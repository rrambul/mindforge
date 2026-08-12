import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "./app-shell.css";

/**
 * The application chrome: a top bar and one content column.
 *
 * Lives in `app/` rather than `shared/ui` because there is exactly one of it. §2.2 rule 7 — something
 * used once belongs to its own layer, and promoting the shell to the design system would be the first
 * step in turning that system into a junk drawer.
 */
export function AppShell({
  bar,
  compact = false,
  children,
}: {
  readonly bar: ReactNode;
  /**
   * Give the page the vertical space the chrome would have taken.
   *
   * Set on the reader and nowhere else (`Shell.tsx` decides). A lesson is a whole
   * document inside a frame that is sized against the viewport, so every row of
   * bar above it is a row the lesson does not get — and on a phone the bar wraps
   * to two rows, which was 113px of app furniture over 512px of lesson.
   */
  readonly compact?: boolean;
  readonly children: ReactNode;
}) {
  // `undefined` rather than "false": an absent attribute is what the stylesheet's
  // `[data-compact="true"]` selectors test for, and a literal "false" in the DOM
  // would read, to anyone inspecting it, as a state that had been set.
  const flag = compact ? "true" : undefined;

  return (
    <div className="mf-shell">
      <header className="mf-topbar" data-compact={flag}>
        {bar}
      </header>
      <main className="mf-main" data-compact={flag}>
        {children}
      </main>
    </div>
  );
}

/**
 * The mark and the name are separate elements because they part ways at phone widths: below 480px
 * the first row has to hold the brand and three controls, and nine tracked mono capitals do not
 * fit beside them. The stylesheet hides the name there by clipping, not `display: none` — the
 * brand keeps its text for the accessibility tree while the mark stands for it visually.
 */
export function Brand({
  mark,
  children,
}: {
  readonly mark: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <span className="mf-brand">
      {mark}
      <span className="mf-brand__name">{children}</span>
    </span>
  );
}

/**
 * The bar's right-hand cluster: everything that is a control rather than a place.
 *
 * A named element rather than a bare div in `Shell`, because the stylesheet owns its layout duty:
 * `margin-inline-start: auto` is what pushes the cluster to the bar's far edge, and on a phone it
 * shares the first row with the brand while the nav takes the second (`app-shell.css`).
 */
export function BarActions({ children }: { readonly children: ReactNode }) {
  return <div className="mf-topbar__actions">{children}</div>;
}

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

/**
 * Links now, not buttons.
 *
 * These were `<button onClick>` while there was no router, which cost more than a URL: middle-click,
 * ⌘-click, "copy link address" and a screen reader's link list all did nothing, because none of them
 * are things a button does. `aria-current="page"` still carries the active state — the stylesheet
 * keys off it and there is no class for it (`app-shell.css`).
 *
 * `activeOptions.exact` matters only for `/`, which is a prefix of every other path and would
 * otherwise read as the current page everywhere.
 */
export function Nav({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly NavItem[];
}) {
  return (
    <nav className="mf-nav" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="mf-nav__item"
          activeOptions={{ exact: item.to === "/" }}
          activeProps={{ "aria-current": "page" }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
