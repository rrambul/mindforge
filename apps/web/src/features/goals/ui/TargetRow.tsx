import { useTranslation } from "react-i18next";
import { Button, StatusChip, Text } from "../../../shared/ui/index.js";
import type { GoalTarget } from "../api/use-goals.js";
import "./goal-card.css";

interface TargetRowProps {
  readonly target: GoalTarget;
  readonly onSetManual: (target: GoalTarget, satisfied: boolean) => void;
  readonly onRemove: (target: GoalTarget) => void;
  readonly editable: boolean;
  readonly pending: boolean;
}

/**
 * One target.
 *
 * The controls are asymmetric on purpose: a `manual` target gets a toggle, and every other kind gets
 * nothing but a reading. That is §3.8 made visible — if the row for a `focus_hours` target had a
 * control, the honest thing it could do is take you to the timer, and the dishonest thing it could do
 * is let you type a number.
 */
export function TargetRow({ target, onSetManual, onRemove, editable, pending }: TargetRowProps) {
  const { t } = useTranslation("goals");
  const { t: g } = useTranslation("glossary");

  return (
    <li className="mf-target">
      <StatusChip>{g(`targetKind.${target.kind}`)}</StatusChip>

      <Text>{describe(target, t as never, g)}</Text>

      <span className="mf-target__spacer" />

      {/* The reading. Null is rendered as a sentence rather than as 0%, and which sentence depends on
          why it cannot be measured — "nothing to measure yet" is about the user's evidence, while
          "not until that part exists" is about the app, and telling someone the second as if it were
          the first sends them off to do work that will not help. */}
      {target.fraction === null ? (
        <Text tone="muted">
          {target.unmeasurable === "not_yet_implemented"
            ? t("target.notYetImplemented")
            : t("target.noData")}
        </Text>
      ) : (
        <Text tone="muted">
          {t("progress.percent", { percent: Math.round(target.fraction * 100) })}
        </Text>
      )}

      {target.met ? <StatusChip>{t("target.met")}</StatusChip> : null}

      {/* The escape hatch, and the only control here: a toggle, never a number. */}
      {target.kind === "manual" && editable ? (
        <Button onClick={() => onSetManual(target, !target.met)} disabled={pending}>
          {target.met ? t("target.manualDone") : t("target.manualNotDone")}
        </Button>
      ) : null}

      {editable ? (
        <Button variant="quiet" onClick={() => onRemove(target)} disabled={pending}>
          {t("target.remove")}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * What the target is asking for, in words.
 *
 * Built from the stored parameters through an ICU message rather than concatenated, so "Read to 80%"
 * and "Ler até 80%" are one key with one set of arguments — and a language that puts the number
 * elsewhere in the sentence can.
 */
function describe(
  target: GoalTarget,
  // `TFunction`'s overloads do not narrow to a plain signature, and the keys here are built from a
  // stored enum value rather than written out, so they cannot be statically checked either way.
  t: (key: string, vars?: Record<string, unknown>) => string,
  g: (key: string) => string,
): string {
  const vars: Record<string, unknown> = { ...target.target };
  // The band is a key, translated from the glossary — never the stored text (§5.2).
  if (typeof vars["band"] === "string") vars["band"] = g(`band.${vars["band"]}`);
  // Stored as a fraction, read as a percentage: 0.85 is "85%" to a person.
  if (typeof vars["accuracy"] === "number") vars["accuracy"] = Math.round(vars["accuracy"] * 100);

  return t(`target.describe.${target.kind}`, vars);
}
