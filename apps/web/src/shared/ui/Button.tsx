import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./styles/button.css";

type Variant = "primary" | "default" | "quiet";

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
