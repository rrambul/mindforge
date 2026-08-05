import type { ReactNode } from "react";
import "./styles/chip.css";

export interface Choice<T> {
  readonly value: T;
  readonly label: ReactNode;
  /** Marks a choice that carries meaning beyond selection — productive struggle is `ember`. */
  readonly accent?: "ember";
}

interface ChoiceGroupProps<T> {
  readonly legend: string;
  readonly choices: readonly Choice<T>[];
  /** Null when nothing is chosen. Absent selection is a state, not a default. */
  readonly value: T | null;
  readonly onChange: (value: T) => void;
}

/**
 * A row of pressable chips — the debrief's answers, the friction taxonomy, a 1–5 rating.
 *
 * One component rather than three because the interaction is identical and the accessibility is the
 * part that gets forgotten: `aria-pressed` is what tells a screen reader which answer is selected,
 * and a coloured background communicates nothing. Centralising it means it cannot be omitted in the
 * fourth place this pattern appears.
 *
 * Buttons rather than radios, deliberately. A radio group announces "1 of 5" and requires arrow-key
 * traversal; these are one-tap targets where any of them may be the first thing you touch.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  choices,
  value,
  onChange,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className="mf-fieldset">
      <legend className="mf-label">{legend}</legend>
      <div className="mf-chip-row">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="mf-chip-button"
            data-accent={choice.accent}
            data-on={value === choice.value ? "true" : undefined}
            aria-pressed={value === choice.value}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
