import {
  MEASURABLE_KINDS_M1,
  SUBJECT_FOR_KIND,
  TARGET_KINDS,
  type CreateGoalTargetInput,
  type TargetKind,
} from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Callout, Field, Row, Select, Stack } from "../../../shared/ui/index.js";

interface AddTargetFormProps {
  /** The things a target can point at, so the picker offers real ones rather than a uuid box. */
  readonly resources: readonly { id: string; title: string }[];
  readonly missions: readonly { id: string; topic: string }[];
  readonly onAdd: (target: CreateGoalTargetInput) => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
}

/**
 * Adding a typed target.
 *
 * Every kind is offered, including the ones the app cannot measure yet, and the form says so instead
 * of hiding them. Writing down "ship an artifact" is an honest thing to want, and the alternative —
 * only offering what M1 can compute — pushes people to record it as a `manual` target and lose the
 * type information the moment artifacts do exist.
 */
export function AddTargetForm({
  resources,
  missions,
  onAdd,
  onCancel,
  pending,
}: AddTargetFormProps) {
  const { t } = useTranslation("goals");
  const { t: g } = useTranslation("glossary");

  const [kind, setKind] = useState<TargetKind>("focus_hours");
  const [subjectId, setSubjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [band, setBand] = useState("fluent");

  const subject = SUBJECT_FOR_KIND[kind];
  const measurable = MEASURABLE_KINDS_M1.includes(kind);

  const subjectOptions =
    subject === "resource"
      ? resources.map((r) => ({ value: r.id, label: r.title }))
      : subject === "mission"
        ? missions.map((m) => ({ value: m.id, label: m.topic }))
        : [];

  // A skill picker would need skills, which do not exist as a screen yet. Offering the kind with no
  // way to choose one would be a dead end, so it is disabled with a reason rather than hidden.
  const subjectMissing = subject !== null && subject !== "skill" && subjectOptions.length === 0;
  const needsSubject = subject !== null;
  const chosenSubject = subjectId === "" ? (subjectOptions[0]?.value ?? "") : subjectId;

  const number = Number.parseInt(amount, 10);
  const numberValid = Number.isFinite(number) && number > 0;
  const needsNumber = kind !== "manual" && kind !== "artifact" && kind !== "skill_band";

  const canSubmit =
    !pending &&
    (!needsSubject || (chosenSubject !== "" && subject !== "skill")) &&
    (!needsNumber || numberValid);

  function submit(): void {
    if (!canSubmit) return;
    onAdd(buildTarget(kind, chosenSubject, number, band));
  }

  return (
    <Stack>
      <Select
        label={t("target.kind")}
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as TargetKind);
          setSubjectId("");
          setAmount("");
        }}
        options={TARGET_KINDS.map((candidate) => ({
          value: candidate,
          label: g(`targetKind.${candidate}`),
        }))}
      />

      {/* Said plainly rather than by disabling the option: the target is real, the measurement is not
          available yet, and pretending otherwise in either direction would be worse. */}
      {measurable ? null : <Callout tone="neutral">{t("target.notYetImplemented")}</Callout>}

      {subject === "skill" ? (
        <Callout tone="neutral">{t("target.noData")}</Callout>
      ) : subjectMissing ? (
        <Callout tone="neutral">{t("target.noData")}</Callout>
      ) : needsSubject ? (
        <Select
          label={t(`target.${subject}`)}
          value={chosenSubject}
          onChange={(event) => setSubjectId(event.target.value)}
          options={subjectOptions}
        />
      ) : null}

      {kind === "skill_band" ? (
        <Select
          label={t("target.band")}
          value={band}
          onChange={(event) => setBand(event.target.value)}
          options={["aware", "assisted", "working", "fluent", "teaching"].map((value) => ({
            value,
            label: g(`band.${value}`),
          }))}
        />
      ) : null}

      {needsNumber ? (
        <Field
          label={t(labelForAmount(kind))}
          type="number"
          inputMode="numeric"
          min={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      ) : null}

      <Row>
        {/* Its own label rather than reusing the card's "Add a target": two buttons with the same
            accessible name and different effects is a genuine ambiguity, and one of them opens this
            form while the other submits it. */}
        <Button variant="primary" onClick={submit} disabled={!canSubmit}>
          {t("target.confirm")}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t("create.close")}
        </Button>
      </Row>
    </Stack>
  );
}

function labelForAmount(kind: TargetKind): string {
  if (kind === "resource_progress") return "target.percent";
  if (kind === "focus_hours") return "target.hours";
  if (kind === "review_accuracy") return "target.accuracy";
  return "target.count";
}

/**
 * The request body for the chosen kind.
 *
 * A switch rather than one wide object, because the schema is a discriminated union and sending a
 * field that belongs to another kind is rejected — correctly. Accuracy is entered as a percentage and
 * stored as a fraction, which is the one place the two differ.
 */
function buildTarget(
  kind: TargetKind,
  subjectId: string,
  amount: number,
  band: string,
): CreateGoalTargetInput {
  switch (kind) {
    case "resource_progress":
      return {
        kind,
        resourceId: subjectId,
        target: { percent: Math.min(100, amount) },
        weight: 1,
      };
    case "focus_hours":
      return { kind, missionId: subjectId, target: { hours: amount }, weight: 1 };
    case "lessons_completed":
      return { kind, missionId: subjectId, target: { count: amount }, weight: 1 };
    case "review_accuracy":
      return {
        kind,
        skillId: subjectId,
        target: { accuracy: Math.min(100, amount) / 100, windowDays: 30 },
        weight: 1,
      };
    case "skill_band":
      return {
        kind,
        skillId: subjectId,
        target: { band: band as "aware" | "assisted" | "working" | "fluent" | "teaching" },
        weight: 1,
      };
    case "artifact":
      return { kind, target: {}, weight: 1 };
    case "manual":
      return { kind, target: {}, weight: 1 };
  }
}
