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

export interface NavItem<T extends string> {
  readonly id: T;
  readonly label: string;
}

/**
 * Two buttons, not a router.
 *
 * TanStack Router is a dependency and this is deliberately not it: a route tree over two screens
 * describes nothing. It earns its place once Today grows a "next" block that deep-links into a
 * mission and mission detail exists to link to — at which point it can be designed against real
 * routes rather than guessed ones.
 */
export function Nav<T extends string>({
  label,
  items,
  current,
  onSelect,
}: {
  readonly label: string;
  readonly items: readonly NavItem<T>[];
  readonly current: T;
  readonly onSelect: (id: T) => void;
}) {
  return (
    <nav className="mf-nav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="mf-nav__item"
          // aria-current, not a class: this is what tells a screen reader which screen you are on.
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
