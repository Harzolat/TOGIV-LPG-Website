import { forwardRef, useId } from "react";
import type {
  ComponentPropsWithoutRef,
  ReactNode,
} from "react";

/**
 * Field wrapper: label + hint + error wired through aria-describedby /
 * aria-invalid. Input/Textarea/Select share the .t-input surface.
 */
interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldShellProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={["t-field", className].filter(Boolean).join(" ")}>
      <label className="t-field__label" htmlFor={inputId}>
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: "var(--error)" }}>
            {" *"}
          </span>
        ) : null}
      </label>
      {children({ inputId, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {hint ? (
        <span className="t-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="t-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface TextInputProps
  extends Omit<ComponentPropsWithoutRef<"input">, "id" | "aria-describedby" | "aria-invalid"> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, required, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <input
          ref={ref}
          id={inputId}
          className="t-input"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </Field>
  );
});

export interface TextAreaProps
  extends Omit<ComponentPropsWithoutRef<"textarea">, "id" | "aria-describedby" | "aria-invalid"> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, required, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={inputId}
          className="t-input"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </Field>
  );
});

export interface SelectProps
  extends Omit<ComponentPropsWithoutRef<"select">, "id" | "aria-describedby" | "aria-invalid"> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, options, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <select
          ref={ref}
          id={inputId}
          className="t-input"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
});
