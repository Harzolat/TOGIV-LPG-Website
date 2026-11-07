import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Modal — accessible dialog: portal, focus trap (initial + Tab cycling),
 * Escape to close, backdrop click, scroll lock, aria-labelledby.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
  /** Disable backdrop-click dismissal (use for destructive confirmations) */
  dismissable?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  dismissable = true,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActive = useRef<Element | null>(null);

  // Initial focus + restore on close
  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => {
      (lastActive.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // Escape to close + scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
      if (e.key === "Tab" && panelRef.current) {
        const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return createPortal(
    <div
      className="t-modal-backdrop"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`t-modal${size === "lg" ? " t-modal--lg" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="t-modal__header">
          <h2 className="t-modal__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="t-icon-btn" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="t-modal__body">{children}</div>
        {footer ? <div className="t-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
