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
  children,
}: {
  readonly bar: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="mf-shell">
      <header className="mf-topbar">{bar}</header>
      <main className="mf-main">{children}</main>
    </div>
  );
}

export function Brand({ children }: { readonly children: ReactNode }) {
  return <span className="mf-brand">{children}</span>;
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
