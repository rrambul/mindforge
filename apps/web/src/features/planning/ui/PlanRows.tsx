import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatMinutes, formatPercent } from "../../../shared/lib/format.js";
import { Figure, Stack, Text } from "../../../shared/ui/index.js";
import type { LabelledPlanRow } from "../api/use-planning.js";
import "./planning.css";

/**
 * Plan versus actual, one row at a time — "the core weekly insight" (FR-F5).
 *
 * The whole component is about which numbers are allowed to exist, and the three cases are three
 * different renderings rather than one with holes in it:
 *
 * - **Planned and worked.** A bar, a percentage, and the delta.
 * - **Planned and untouched.** The same bar at zero and a delta of −everything. Zero here is a
 *   *measurement* — you said four hours of Rust and did none — and the one place in this product
 *   where an empty bar is the honest drawing rather than a claim about nothing.
 * - **Unplanned.** No bar, no percentage, no delta. Two hours against a plan of nothing is not 200%,
 *   not infinite, and not "over target"; it is work you did without planning it, and the row says
 *   that in words.
 *
 * There is no colour and no "on track" flag anywhere in here, for the reason `plan-vs-actual.ts`
 * gives: a week where you planned wrong and worked well looks identical to one where you planned
 * right and slacked, and only you can tell which.
 */
export function PlanRows({ rows }: { readonly rows: readonly LabelledPlanRow[] }) {
  return (
    <ul className="mf-plan-rows">
      {rows.map((row) => (
        <li key={`${row.subject.kind}:${row.subject.id}`} className="mf-plan-row">
          {row.plannedMinutes === null ? <UnplannedRow row={row} /> : <PlannedRow row={row} />}
        </li>
      ))}
    </ul>
  );
}

function PlannedRow({ row }: { readonly row: LabelledPlanRow }) {
  const { t, i18n } = useTranslation("planning");
  const locale = i18n.language;

  // Narrowed by the caller; restated so the arithmetic below needs no assertions.
  const planned = row.plannedMinutes ?? 0;
  const percent = row.attainment === null ? null : Math.round(row.attainment * 100);

  return (
    <Stack gap="tight">
      <div className="mf-plan-row__head">
        <span className="mf-plan-row__label">
          <RowLabel row={row} />
        </span>
        {percent === null ? null : <Figure>{formatPercent(row.attainment ?? 0, locale)}</Figure>}
      </div>

      {percent === null ? null : (
        <div
          className="mf-plan-bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          // Not clamped to 100: overshooting a target is a real reading, and an `aria-valuenow`
          // above its own max is what a screen reader announces as broken markup.
          aria-valuemax={Math.max(100, percent)}
          aria-label={t("row.attainmentLabel", { label: row.label ?? t("row.unnamed") })}
        >
          <div
            className="mf-plan-bar__fill"
            // Capped at the track. The hatch, not an overflowing box, is what says "past the end".
            style={{ width: `${Math.min(100, percent)}%` }}
            {...(percent > 100 ? { "data-over": "true" } : {})}
          />
        </div>
      )}

      <div className="mf-plan-row__figures">
        <PlanFigure caption={t("row.planned")} value={formatMinutes(planned, locale)} />
        <PlanFigure caption={t("row.actual")} value={formatMinutes(row.actualMinutes, locale)} />
        <PlanFigure caption={t("row.delta")} value={<Delta minutes={row.deltaMinutes} />} />
      </div>
    </Stack>
  );
}

/**
 * Work with no target behind it.
 *
 * Deliberately not styled as a shortfall or a bonus. The review is supposed to *show* you this, not
 * score it — half of what a weekly review is for is noticing the hours that went somewhere you never
 * wrote down.
 */
function UnplannedRow({ row }: { readonly row: LabelledPlanRow }) {
  const { t, i18n } = useTranslation("planning");

  return (
    <Stack gap="tight">
      <div className="mf-plan-row__head">
        <span className="mf-plan-row__label">
          <RowLabel row={row} />
        </span>
        <Figure>{formatMinutes(row.actualMinutes, i18n.language)}</Figure>
      </div>
      <Text tone="muted">{t("row.unplanned")}</Text>
    </Stack>
  );
}

function PlanFigure({ caption, value }: { readonly caption: string; readonly value: ReactNode }) {
  return (
    <span className="mf-plan-figure">
      <Text as="span" tone="hint">
        {caption}
      </Text>
      <Figure>{value}</Figure>
    </span>
  );
}

/**
 * The delta, said in words rather than with a sign glyph.
 *
 * "30m over" beats "+30m": the sign is a symbol you have to remember the convention for, and the
 * shortfall case ("45m under") is the one people misread. The numbers themselves still go through
 * `Intl`, and only the direction is a translated string.
 */
function Delta({ minutes }: { readonly minutes: number | null }) {
  const { t, i18n } = useTranslation("planning");
  if (minutes === null) return null;

  const amount = formatMinutes(Math.abs(minutes), i18n.language);
  if (minutes === 0) return <>{t("row.onTarget")}</>;
  return <>{minutes > 0 ? t("row.over", { amount }) : t("row.under", { amount })}</>;
}

/**
 * A row whose subject has no readable name.
 *
 * The API sends `label: null` rather than "Unknown" precisely so this decision is made here: the
 * sessions are real and the minutes are real, and dropping the row would quietly change the totals.
 */
function RowLabel({ row }: { readonly row: LabelledPlanRow }) {
  const { t } = useTranslation("planning");

  if (row.label === null) {
    return (
      <Text as="span" tone="muted">
        {t("row.unnamed")}
      </Text>
    );
  }
  return <>{row.label}</>;
}
