import { useTranslation } from "react-i18next";

import { Callout, Card, Heading, ProgressBar, Stack, Text } from "../../../shared/ui/index.js";
import { useTeachSpend } from "../api/use-spend.js";

/**
 * What teaching has cost today, and what is left (FR-T8).
 *
 * `llm_calls` has recorded every model call since M3 — deduplicated per message, with
 * a reconciliation row so a run's rows sum to its real bill — and nothing ever read
 * them. The learner could not find out what a lesson had cost them, which sits badly
 * beside a product whose tenth non-negotiable is honesty about its own numbers.
 *
 * Four things it refuses to do, all the same rule in different clothes:
 *
 * 1. **No percentage.** The same reasoning `ProgressBar` gives: the bar is a second
 *    channel for the figure beside it, and the figure stays money.
 * 2. **"At least" when some calls could not be priced.** A model missing from the
 *    pricing table produces a null `cost_usd`, and the total is then a floor. Printing
 *    it as a total would be understating a bill.
 * 3. **No bar at all when nothing is capped.** An uncapped deployment has no
 *    denominator, and a bar at zero claims a measurement against a limit nobody set.
 * 4. **No celebration for spending little.** It is a meter, not a score.
 */
export function SpendPanel() {
  const { t } = useTranslation("teach");
  const { t: common } = useTranslation("common");

  const spend = useTeachSpend();

  return (
    <Card as="section" label={t("spend.heading")}>
      <Stack>
        <Heading level={2}>{t("spend.heading")}</Heading>

        {spend.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

        {/* Stated rather than hidden: a meter that silently shows nothing is
            indistinguishable from a day with no spending. */}
        {spend.isError ? <Text tone="muted">{t("spend.unavailable")}</Text> : null}

        {spend.isSuccess ? <Meter spend={spend.data} /> : null}
      </Stack>
    </Card>
  );
}

function Meter({
  spend,
}: {
  readonly spend: NonNullable<ReturnType<typeof useTeachSpend>["data"]>;
}) {
  const { t } = useTranslation("teach");

  const spent = money(spend.spentUsd);
  const total = spend.atLeast
    ? t("spend.atLeast", { amount: spent })
    : t("spend.spent", { amount: spent });

  return (
    <Stack gap="tight">
      <Text>{total}</Text>

      {spend.capUsd === null ? (
        // No ceiling configured. Said in a sentence rather than drawn as an empty
        // bar, which would imply a limit exists and has barely been touched.
        <Text tone="hint">{t("spend.noCap")}</Text>
      ) : (
        <>
          {/* Cents, so a $15 cap and a $2.50 spend are whole units the bar can
              divide. Passing dollars would round both to integers and draw 2/15
              of a bar as 0. */}
          <ProgressBar
            completed={Math.round(spend.spentUsd * 100)}
            total={Math.round(spend.capUsd * 100)}
            label={t("spend.barLabel")}
            valueText={t("spend.ofCap", { spent, cap: money(spend.capUsd) })}
          />
          <Text tone="muted">{t("spend.ofCap", { spent, cap: money(spend.capUsd) })}</Text>
        </>
      )}

      {spend.unpricedCalls > 0 ? (
        <Text tone="hint">{t("spend.unpriced", { count: spend.unpricedCalls })}</Text>
      ) : null}

      {spend.exhausted ? (
        // `live`, because this is the answer to a button that has just stopped
        // working, and it names when it stops being true.
        <Callout tone="neutral" live>
          <Text>{t("spend.exhausted")}</Text>
        </Callout>
      ) : null}
    </Stack>
  );
}

/**
 * USD, always, whatever language the interface is in.
 *
 * Not `Intl.NumberFormat` against the UI locale: the bill is charged in dollars, and
 * rendering it as `R$ 2,50` for a pt-BR reader would name a currency nobody was
 * charged. The separator convention follows the locale; the currency does not.
 */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
