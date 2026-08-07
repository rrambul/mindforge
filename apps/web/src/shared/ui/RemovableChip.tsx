import type { ReactNode } from "react";
import "./styles/chip.css";

interface RemovableChipProps {
  /** A name — a mission's topic, a skill's name. Set in sentence case, not as a status. */
  readonly children: ReactNode;
  /** The accessible name of the × button, already translated: "Unlink", "Remove". */
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
}

/**
 * A named thing you can take off — a linked mission, a prerequisite.
 *
 * Not `StatusChip` with a button beside it, which is what both callers did before. Two problems came
 * with that: an underlined "Unlink" after every chip made a row of three links six things to read,
 * with the verb louder than the name it applied to; and `StatusChip` is uppercase and letter-spaced
 * because it renders *statuses*, so a mission called "Rust ownership" arrived shouting in the same
 * voice as "QUEUED" and stopped looking like a name at all.
 *
 * So the name is set plainly and the × carries the action, with the words in `aria-label` where a
 * screen reader still reads them in full.
 *
 * The × is under the 44px touch floor on purpose: §5.1 sets that for capture paths, and unlinking is
 * not one — a 44px square on every chip would make three prerequisites taller than the card's title.
 * It stays above WCAG 2.2's 24px minimum.
 */
export function RemovableChip({
  children,
  removeLabel,
  onRemove,
  disabled = false,
}: RemovableChipProps) {
  return (
    <span className="mf-removable-chip">
      <span className="mf-removable-chip__name">{children}</span>
      <button
        type="button"
        className="mf-removable-chip__remove"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        disabled={disabled}
      >
        {/* Multiplication sign, not the letter x: it is a symbol here, and the glyph is centred. */}
        ×
      </button>
    </span>
  );
}
