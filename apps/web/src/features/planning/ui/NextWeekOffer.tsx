import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatMinutes } from "../../../shared/lib/format.js";
import { Button, Callout, Figure, Row, Stack, Text } from "../../../shared/ui/index.js";
import { formatNameList } from "../model/name-list.js";
import type { NextWeekProposal } from "../model/review-summary.js";
import "./planning.css";

/**
 * Next week, prefilled from this week's actuals — the loop closing (FR-F6).
 *
 * Not a primary action. The screen's one primary is completing the review; this is the thing you do
 * *because of* the review, and making both shout would leave neither meaning anything (§5.3).
 *
 * Three honesty rules are carried here rather than in the model, because each is about what the
 * screen says rather than what it sends:
 *
 * - **It says it will replace.** `PUT /plans/:weekStart` overwrites the week, so a next week that
 *   already has targets loses them. Silently is not an option — that is somebody's Sunday evening.
 * - **It names what it is dropping.** A planned row with no minutes cannot be carried forward,
 *   because zero is not an allocation. Vanishing without a word looks like the app deciding you had
 *   given up on it.
 * - **It offers nothing when there is nothing.** A week with no logged minutes renders no block.
 */
export interface NextWeekOfferProps {
  readonly proposal: NextWeekProposal;
  /** What next week already has planned. Zero means the offer takes nothing away. */
  readonly alreadyPlannedMinutes: number;
  readonly pending: boolean;
  readonly saved: boolean;
  /** Already translated by the route. */
  readonly error: string | null;
  readonly onApply: () => void;
  /** A link to next week's grid, supplied by the app layer. */
  readonly link?: ReactNode;
}

export function NextWeekOffer({
  proposal,
  alreadyPlannedMinutes,
  pending,
  saved,
  error,
  onApply,
  link,
}: NextWeekOfferProps) {
  const { t, i18n } = useTranslation("planning");
  const locale = i18n.language;

  if (proposal.rows.length === 0) return null;

  return (
    <Stack gap="tight">
      <ul className="mf-plan-rows">
        {proposal.rows.map((row) => (
          <li key={row.key} className="mf-friction-row">
            <span className="mf-plan-row__label">
              {row.label ?? (
                <Text as="span" tone="muted">
                  {t("row.unnamed")}
                </Text>
              )}
            </span>
            <Figure>{formatMinutes(row.minutes, locale)}</Figure>
          </li>
        ))}
      </ul>

      <Text tone="muted">
        {t("next.total", { amount: formatMinutes(proposal.totalMinutes, locale) })}
      </Text>

      {proposal.dropped.length === 0 ? null : (
        <Text tone="hint">
          {t("next.dropped", {
            count: proposal.dropped.length,
            names: formatNameList(
              proposal.dropped.map((row) => row.label ?? t("row.unnamed")),
              locale,
            ),
          })}
        </Text>
      )}

      {alreadyPlannedMinutes > 0 ? (
        <Callout tone="warning">
          {t("next.replaces", { amount: formatMinutes(alreadyPlannedMinutes, locale) })}
        </Callout>
      ) : null}

      {error === null ? null : (
        <Callout tone="danger" live>
          {error}
        </Callout>
      )}

      <Row>
        <Button onClick={onApply} disabled={pending}>
          {alreadyPlannedMinutes > 0 ? t("next.applyReplacing") : t("next.apply")}
        </Button>
        {/* The link is what confirms it landed — the grid showing the new targets is a better
            confirmation than a sentence saying it saved, which is why `Callout` has no success
            tone. It appears only once there is something new to go and look at. */}
        {saved ? link : null}
      </Row>
    </Stack>
  );
}
