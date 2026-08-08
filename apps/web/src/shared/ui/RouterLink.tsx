import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "./styles/button.css";

/**
 * An in-app link, styled like a control.
 *
 * The gap this fills: `ButtonLink` is a plain `<a href>` and navigates by reloading the document,
 * which throws away the session, the query cache and the offline queue — fine for an outbound link
 * to a resource, wrong for moving between two weeks. TanStack's `Link` does the right thing and
 * arrives unstyled, so until now the only way to draw one was to write `className="mf-nav__item"` by
 * hand, which is what `AppShell` does and what §2.2 rule 7 exists to stop spreading.
 *
 * It is a link and not a `Button` with `useNavigate`, deliberately. A week has a URL — that is the
 * entire point of `/weeks/$weekStart` — and middle-click, ⌘-click, "copy link address" and a screen
 * reader's link list are all things only an anchor does.
 *
 * `className` is not accepted, for the same reason `Button` refuses it.
 */
interface RouterLinkProps {
  /** A path in the app's own route tree. */
  readonly to: string;
  readonly variant?: "primary" | "default" | "quiet";
  /**
   * Exact matching for a path that is a prefix of others. `/weeks/2026-08-03` is a prefix of
   * `/weeks/2026-08-03/review`, so without this the week link reads as the current page while you
   * are looking at the review.
   */
  readonly exact?: boolean;
  readonly children: ReactNode;
}

export function RouterLink({ to, variant = "quiet", exact = false, children }: RouterLinkProps) {
  return (
    <Link
      to={to}
      className="mf-button"
      data-variant={variant}
      activeOptions={{ exact }}
      // The state lives on the element the stylesheet and the accessibility tree both read, rather
      // than in a class only one of them understands.
      activeProps={{ "aria-current": "page" }}
    >
      {children}
    </Link>
  );
}
