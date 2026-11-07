import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
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
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-describedby" | "aria-invalid"> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextInput({ label, hint, error, required, className, ...rest }: TextInputProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <input
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
}

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "aria-describedby" | "aria-invalid"> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextArea({ label, hint, error, required, className, ...rest }: TextAreaProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
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
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "aria-describedby" | "aria-invalid"> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export function Select({ label, hint, error, required, options, className, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <select
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
}
