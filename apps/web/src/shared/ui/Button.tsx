import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "default" | "quiet";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: Variant;
  readonly children: ReactNode;
}

const CLASS: Record<Variant, string> = {
  primary: "mf-button mf-button--primary",
  default: "mf-button",
  quiet: "mf-button mf-button--quiet",
};

/**
 * `type="button"` by default, because the browser's default is `submit` and a button
 * inside a form that was meant to be an action then submits it. `className` is
 * deliberately not accepted: variants live here so a one-off style has to become a
 * variant, which is what keeps shared/ui from turning into a junk drawer (§2.2 rule 7).
 */
export function Button({ variant = "default", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={CLASS[variant]} {...rest} />;
}
