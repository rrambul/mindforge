import { useId, type SelectHTMLAttributes } from "react";
import "./styles/field.css";

export interface SelectOption {
  readonly value: string;
  /** Already translated. Enum values are keys; the caller resolves them (§5.2). */
  readonly label: string;
}

interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className" | "id" | "children"
> {
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly hint?: string;
}

/**
 * A labelled native `<select>`.
 *
 * Native rather than a rebuilt listbox, and not `ChoiceGroup`: chips are for a handful of options
 * you compare at a glance, while this is for a list you pick from. On a phone the platform picker is
 * a full-height wheel with type-ahead and correct keyboard handling — none of which a div-based
 * replacement gets for free, and all of which the capture budget depends on.
 */
export function Select({ label, options, hint, ...rest }: SelectProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="mf-field">
      <label className="mf-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="mf-field__control"
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <span id={hintId} className="mf-text" data-tone="hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
