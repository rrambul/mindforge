import type { FrictionSplit } from "@mindforge/core";
import { useTranslation } from "react-i18next";
import { formatMinutes, formatPercent } from "../../../shared/lib/format.js";
import { Stack, Text } from "../../../shared/ui/index.js";
import "./planning.css";

/**
 * Ember against slag, as one bar (§9.3b).
 *
 * **`emberShare: null` is not zero, and this is the component where getting that wrong would lie
 * loudest.** Null means nothing was attributed — you logged no friction inside a finished session —
 * and a full slag bar would say every minute of friction you hit was wasted, which is a measurement
 * nobody took. It renders as a dashed track and a sentence, the same shape a goal with nothing
 * measurable uses.
 *
 * The pair is `--mf-ember` / `--mf-slag` and deliberately not green and red: productive friction
 * feels bad and is good for you, so a good/bad palette would moralise about the one number this
 * product most wants you to read honestly.
 */
export function SplitBar({ split }: { readonly split: FrictionSplit }) {
  const { t, i18n } = useTranslation("planning");
  const locale = i18n.language;

  if (split.emberShare === null) {
    return (
      <Stack gap="tight">
        <div className="mf-split-bar" data-unmeasured="true" />
        <Text tone="muted">{t("split.unmeasured")}</Text>
      </Stack>
    );
  }

  const emberPercent = Math.round(split.emberShare * 100);

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
        <span className="mf-split-key" data-kind="ember" aria-hidden="true" />{" "}
        {t("split.ember", {
          share: formatPercent(split.emberShare, locale),
          amount: formatMinutes(split.emberMinutes, locale),
        })}
        {" · "}
        <span className="mf-split-key" data-kind="slag" aria-hidden="true" />{" "}
        {t("split.slag", { amount: formatMinutes(split.slagMinutes, locale) })}
      </Text>
    </Stack>
  );
}
