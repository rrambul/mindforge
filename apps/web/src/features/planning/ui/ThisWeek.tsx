import type { FrictionSplit } from "@mindforge/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatMinutes, formatPercent } from "../../../shared/lib/format.js";
import { Figure, Label, Spread, Stack, Text } from "../../../shared/ui/index.js";
import "./planning.css";

/**
 * Today's `THIS WEEK` block (§5.3): planned against actual as one bar, ember against slag as one
 * more, and nothing else.
 *
 * §5.3 reserves exactly two bars here and the restraint is the design. Today's job is to get you into
 * a session in one tap; the week is context, not a dashboard, and anyone who wants the rows follows
 * the link to the week itself.
 *
 * **It returns `null` rather than an empty block.** A week with no plan, no minutes and no attributed
 * friction has nothing true to say, and §5.3 is explicit that an empty section is worse than no
 * section — a block manufactured to fill space trains you to stop reading the ones that mean
 * something.
 *
 * Dumb, like everything in `ui/`: the route above fetches. Composed into `TodayScreen` from `app/`,
 * because §2.2 rule 6 keeps `focus` and `planning` from importing each other.
 */
export interface ThisWeekProps {
  readonly plannedMinutes: number;
  readonly actualMinutes: number;
  /** actual ÷ planned, or null when the week had no plan. Never rendered as 0% or ∞. */
  readonly attainment: number | null;
  /** Absent while the friction query is still in flight, which is different from having none. */
  readonly split?: FrictionSplit | undefined;
  /** A link to the week itself, supplied by the app layer — a feature cannot know the route tree. */
  readonly link?: ReactNode;
}

export function ThisWeek({
  plannedMinutes,
  actualMinutes,
  attainment,
  split,
  link,
}: ThisWeekProps) {
  const { t, i18n } = useTranslation("planning");
  const locale = i18n.language;

  const hasSplit = split !== undefined && split.emberShare !== null;
  if (plannedMinutes === 0 && actualMinutes === 0 && !hasSplit) return null;

  const percent = attainment === null ? null : Math.round(attainment * 100);

  return (
    <Stack gap="tight">
      <Spread>
        <Label>{t("thisWeek.heading")}</Label>
        {link}
      </Spread>

      {percent === null ? (
        // No plan is not a plan of zero. The minutes are still worth showing — they are the honest
        // half of the comparison — and the sentence says which half is missing.
        <Stack gap="tight">
          <Figure>{formatMinutes(actualMinutes, locale)}</Figure>
          <Text tone="muted">{t("thisWeek.noPlan")}</Text>
        </Stack>
      ) : (
        <Stack gap="tight">
          <div
            className="mf-plan-bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={Math.max(100, percent)}
            aria-label={t("thisWeek.barLabel")}
          >
            <div
              className="mf-plan-bar__fill"
              style={{ width: `${Math.min(100, percent)}%` }}
              {...(percent > 100 ? { "data-over": "true" } : {})}
            />
          </div>
          <Text tone="muted">
            {t("thisWeek.progress", {
              actual: formatMinutes(actualMinutes, locale),
              planned: formatMinutes(plannedMinutes, locale),
              share: formatPercent(attainment ?? 0, locale),
            })}
          </Text>
        </Stack>
      )}

      {/* Absent, not empty. On every other screen a null share earns a sentence explaining what was
          not measured; on Today that sentence is the filler §5.3 rules out. */}
      {hasSplit ? <SplitLine split={split} /> : null}
    </Stack>
  );
}

function SplitLine({ split }: { readonly split: FrictionSplit }) {
  const { t, i18n } = useTranslation("planning");
  const emberPercent = Math.round((split.emberShare ?? 0) * 100);

  return (
    <Stack gap="tight">
      <div
        className="mf-split-bar"
        role="progressbar"
        aria-valuenow={emberPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("split.label")}
      >
        <div className="mf-split-bar__ember" style={{ width: `${emberPercent}%` }} />
        <div className="mf-split-bar__slag" style={{ width: `${100 - emberPercent}%` }} />
      </div>
      <Text tone="muted">
        {t("thisWeek.split", {
          share: formatPercent(split.emberShare ?? 0, i18n.language),
        })}
      </Text>
    </Stack>
  );
}
