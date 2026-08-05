import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface Shared {
  readonly label: string;
  readonly hint?: string;
  /** Already translated. Field-level copy is resolved from a code by the caller. */
  readonly error?: string | undefined;
}

type InputProps = Shared & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id">;
type TextareaProps = Shared & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "id">;

/**
 * A labelled control.
 *
 * `aria-describedby` points at the hint and the error together, and `aria-invalid`
 * marks the state — a red border alone communicates nothing to a screen reader, and
 * WCAG AA is a requirement rather than an aspiration here (REQUIREMENTS.md §7.6).
 * The error is a live region so it is announced when validation fails after submit
 * rather than only on focus.
 */
export function Field({ label, hint, error, ...rest }: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="mf-field">
      <label className="mf-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="mf-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : null, error ? errorId : null)}
        {...rest}
      />
      {hint ? (
        <span id={hintId} className="mf-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="mf-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextareaField({ label, hint, error, ...rest }: TextareaProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="mf-field">
      <label className="mf-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="mf-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : null, error ? errorId : null)}
        {...rest}
      />
      {hint ? (
        <span id={hintId} className="mf-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="mf-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Undefined rather than an empty string: `aria-describedby=""` points at nothing. */
function describedBy(...ids: (string | null)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== null);
  return present.length > 0 ? present.join(" ") : undefined;
}
