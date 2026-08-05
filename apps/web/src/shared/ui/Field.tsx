import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import "./styles/field.css";

interface Shared {
  readonly label: string;
  readonly hint?: string;
  /** Already translated. Field-level copy is resolved from a machine code by the caller. */
  readonly error?: string | undefined;
}

type InputProps = Shared & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id">;
type TextareaProps = Shared & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "id">;

/**
 * A labelled control.
 *
 * The accessibility here is the reason this is a component rather than a convention:
 * `aria-describedby` points at the hint and the error together, `aria-invalid` marks the state, and
 * the error is a live region so it is announced on a failed submit rather than only on focus. A red
 * border alone says nothing to a screen reader, and WCAG AA is a requirement here rather than an
 * aspiration (REQUIREMENTS.md §7.6).
 */
export function Field({ label, hint, error, ...rest }: InputProps) {
  const ids = useFieldIds();

  return (
    <div className="mf-field">
      <label className="mf-label" htmlFor={ids.control}>
        {label}
      </label>
      <input
        id={ids.control}
        className="mf-field__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy(hint, error)}
        {...rest}
      />
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  );
}

export function TextareaField({ label, hint, error, ...rest }: TextareaProps) {
  const ids = useFieldIds();

  return (
    <div className="mf-field">
      <label className="mf-label" htmlFor={ids.control}>
        {label}
      </label>
      <textarea
        id={ids.control}
        className="mf-field__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy(hint, error)}
        {...rest}
      />
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  );
}

interface FieldIds {
  readonly control: string;
  readonly hint: string;
  readonly error: string;
  readonly describedBy: (hint?: string, error?: string) => string | undefined;
}

function useFieldIds(): FieldIds {
  const id = useId();
  return {
    control: id,
    hint: `${id}-hint`,
    error: `${id}-error`,
    // Undefined rather than "": `aria-describedby=""` points at nothing and is worse than absent.
    describedBy(hint, error) {
      const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(
        (value): value is string => value !== null,
      );
      return ids.length > 0 ? ids.join(" ") : undefined;
    },
  };
}

function FieldMessages({
  ids,
  hint,
  error,
}: {
  readonly ids: FieldIds;
  // `| undefined` spelled out: exactOptionalPropertyTypes makes "absent" and "present but
  // undefined" different types, and these are forwarded from an optional prop.
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}) {
  return (
    <>
      {hint ? (
        <span id={ids.hint} className="mf-text" data-tone="hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={ids.error} className="mf-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
