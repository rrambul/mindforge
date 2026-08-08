import { Figure, Text } from "../../../shared/ui/index.js";
import "./insights.css";

interface MeterProps {
  /** Already translated. */
  readonly label: string;
  readonly value: number;
  /** The largest value in the list, so the bars rank against each other rather than against 100. */
  readonly max: number;
  /** A second fact about the row — mean intensity, or what an unattributed count is made of. */
  readonly hint?: string;
  readonly variant?: "unattributed";
}

/**
 * One row of a ranked list, as a bar.
 *
 * There is no charting library in this repo and there is not going to be one: every meter in the app
 * is a div with a width and a `role="progressbar"`, and this is that shape again rather than a
 * fourth invention of it.
 *
 * Bars are scaled to the largest row, not to the total. A list of eleven friction types scaled to
 * the total is eleven slivers, and the question the list answers is "which of these is biggest".
 */
export function Meter({ label, value, max, hint, variant }: MeterProps) {
  const percent = max <= 0 ? 0 : Math.round((value / max) * 100);

  return (
    <div className="mf-meter">
      <div className="mf-meter__head">
        <Text as="span">{label}</Text>
        <Figure>{value}</Figure>
      </div>
      <div
        className="mf-meter__track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className="mf-meter__fill"
          {...(variant === undefined ? {} : { "data-variant": variant })}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hint === undefined ? null : <Text tone="hint">{hint}</Text>}
    </div>
  );
}
