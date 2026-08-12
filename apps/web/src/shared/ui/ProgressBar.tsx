import "./styles/progress.css";

/**
 * A fraction, drawn.
 *
 * **It never shows a percentage, and it is not a replacement for the fraction beside
 * it.** `ModulePanel` has said since M4 that "2 of 7" is rendered as a fraction and not
 * as a percentage, because a percentage of a plan that gets revised reads as a
 * measurement of the learner while a fraction reads as a count against a plan that can
 * change. That reasoning survives here: the bar is the same count in a second channel,
 * for finding the module you are mid-way through in a list of fourteen. The number stays
 * a fraction, and no "28%" appears anywhere.
 *
 * **There is no bar for something unmeasured.** A module with no lessons has null
 * progress and gets no `ProgressBar` at all — an empty bar is a claim that something was
 * measured and came out at zero, which is the exact failure non-negotiable 10 names. A
 * module that *has* lessons and has finished none renders an empty fill, and that is
 * different: those zeroes are measured.
 *
 * `role="progressbar"` with `aria-valuetext` set to the fraction, so a screen reader
 * hears "2 of 7 lessons done" rather than a percentage nothing on screen states.
 */
export function ProgressBar({
  completed,
  total,
  label,
  valueText,
}: {
  readonly completed: number;
  readonly total: number;
  /** Names what is being measured, since the bar itself has no text. */
  readonly label: string;
  /** What a screen reader reads instead of a percentage. */
  readonly valueText: string;
}) {
  // Guarded rather than assumed: `total` comes from a plan that can be revised, and a
  // 0 here would make the fill `NaN%` — which renders as a full bar in some engines and
  // an empty one in others.
  const fraction = total > 0 ? Math.min(Math.max(completed / total, 0), 1) : 0;

  return (
    <div
      className="mf-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-valuetext={valueText}
    >
      {/* A scale rather than a width, so the fill animates on the compositor and a
          module that gains a lesson does not repaint the whole list. */}
      <div
        className="mf-progress__fill"
        data-empty={completed === 0 ? "true" : undefined}
        style={{ scale: `${String(fraction)} 1` }}
      />
    </div>
  );
}
