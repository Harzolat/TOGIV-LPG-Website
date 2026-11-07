import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button — variants map to semantic tokens (brand-swap via CSS variables).
 * Loading state keeps width stable and sets aria-busy for screen readers.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  icon,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "t-btn",
    `t-btn--${variant}`,
    `t-btn--${size}`,
    block ? "t-btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="t-btn__spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
