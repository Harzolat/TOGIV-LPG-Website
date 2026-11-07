import type { HTMLAttributes, ReactNode } from "react";

/** Card — standard surface container with optional header. */
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
  children?: ReactNode;
}

export function Card({ title, actions, padded, children, className, ...rest }: CardProps) {
  return (
    <div className={["t-card", className].filter(Boolean).join(" ")} {...rest}>
      {title ? (
        <div className="t-card__header">
          <h2 className="t-card__title">{title}</h2>
          {actions}
        </div>
      ) : null}
      {padded ? <div className="t-card__body">{children}</div> : children}
    </div>
  );
}
