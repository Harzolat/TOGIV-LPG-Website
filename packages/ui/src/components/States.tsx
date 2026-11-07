import type { ReactNode } from "react";

/**
 * Empty / error / loading states — consistent messaging pattern
 * (plan: empty, loading, error, permission and offline states).
 */

export interface StateBlockProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: StateBlockProps) {
  return (
    <div className="t-state">
      {icon ? (
        <div className="t-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="t-state__title">{title}</p>
      {description ? <p className="t-state__desc">{description}</p> : null}
      {action ? <div className="t-state__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ icon, title, description, action }: StateBlockProps) {
  return (
    <div className="t-state" role="alert">
      {icon ? (
        <div className="t-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="t-state__title">{title}</p>
      {description ? <p className="t-state__desc">{description}</p> : null}
      {action ? <div className="t-state__action">{action}</div> : null}
    </div>
  );
}

export function Spinner({ size = 24, label }: { size?: number; label?: string }) {
  return (
    <span
      className="t-spinner"
      style={{ width: size, height: size, display: "inline-block" }}
      role={label ? "status" : undefined}
      aria-label={label}
    />
  );
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string;
}) {
  return (
    <span
      className="t-skeleton"
      aria-hidden="true"
      style={{ display: "block", width, height, borderRadius: radius }}
    />
  );
}
