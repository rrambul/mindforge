import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import "./styles/button.css";

type Variant = "primary" | "default" | "quiet" | "bar";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: Variant;
  readonly children: ReactNode;
}

/**
 * `type="button"` by default, because the browser's default is `submit` — an action button inside a
 * form otherwise submits it, which is a bug you find by accident.
 *
 * `className` is deliberately not accepted. A one-off style has to become a variant, which is what
 * keeps shared/ui a design system rather than a junk drawer (§2.2 rule 7).
 */
export function Button({ variant = "default", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className="mf-button" data-variant={variant} {...rest} />;
}

interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> {
  readonly variant?: Variant;
  readonly href: string;
  readonly children: ReactNode;
}

/**
 * A link that looks like a button.
 *
 * A separate component rather than a polymorphic `as` prop on `Button`, because the two are not
 * interchangeable: a link navigates, so it must be an `<a>` for middle-click, open-in-new-tab, and
 * copy-link to work, and it takes `href` rather than `onClick`. Collapsing them into one component
 * makes it possible to write a `<button href>`, which does nothing at all.
 *
 * It lives here rather than in a feature — despite one caller today — for the reason `Button` refuses
 * `className`: a feature has no way to style its own anchor, so without this the only options are a
 * bare link where a button belongs or a hole in the design system.
 */
export function ButtonLink({ variant = "default", target, rel, ...rest }: ButtonLinkProps) {
  return (
    <a
      className="mf-button"
      data-variant={variant}
      {...(target === undefined ? {} : { target })}
      // `noreferrer` implies `noopener`, and omitting it on a `target="_blank"` link hands the
      // opened page a handle on this one. Defaulted rather than left to each caller to remember.
      rel={rel ?? (target === "_blank" ? "noreferrer" : undefined)}
      {...rest}
    />
  );
}
