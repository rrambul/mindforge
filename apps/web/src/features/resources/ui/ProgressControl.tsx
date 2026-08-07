import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CardSection, Field, Row, Text } from "../../../shared/ui/index.js";
import type { Resource } from "../api/use-resources.js";

interface ProgressControlProps {
  readonly resource: Resource;
  readonly onMark: (current: number, total: number | null) => void;
  readonly pending: boolean;
}

/**
 * "Page 137 of 590" — a capture path (§5.1), so it is one number and one tap.
 *
 * The total is only asked for while it is unknown. Once given it stops being a field, because
 * re-typing 590 every time you close the book is exactly the friction that makes people stop
 * recording progress at all.
 */
export function ProgressControl({ resource, onMark, pending }: ProgressControlProps) {
  const { t } = useTranslation("resources");
  const unit = resource.progress?.unit ?? "none";
  const knownTotal = resource.progress?.total ?? null;

  const [current, setCurrent] = useState("");
  const [total, setTotal] = useState("");

  if (!resource.isMeasurable) {
    // Not a disabled control: there is nothing to enable. An article is read or not (FR-R1).
    return <Text tone="muted">{t("notMeasured")}</Text>;
  }

  const position = Number.parseInt(current, 10);
  const enteredTotal = Number.parseInt(total, 10);
  const resolvedTotal = knownTotal ?? (Number.isFinite(enteredTotal) ? enteredTotal : null);
  const valid = Number.isFinite(position) && position >= 0;

  function submit(): void {
    if (!valid) return;
    onMark(position, resolvedTotal);
    setCurrent("");
    setTotal("");
  }

  return (
    // Its own section: this is the one thing on the card you type into, and under `Card`'s even gap
    // it sat between the position text and the link chips looking like more of the same.
    <CardSection>
      <Row>
        <Field
          label={t("progress.label", { unit })}
          type="number"
          inputMode="numeric"
          min={0}
          {...(knownTotal === null ? {} : { max: knownTotal })}
          value={current}
          // The current position, so the box shows where you are without pre-filling a value that
          // would be re-submitted unchanged by a stray tap on Save.
          placeholder={String(resource.progress?.current ?? 0)}
          onChange={(event) => setCurrent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />

        {knownTotal === null ? (
          <Field
            label={t("progress.unknownTotal")}
            type="number"
            inputMode="numeric"
            min={1}
            value={total}
            onChange={(event) => setTotal(event.target.value)}
          />
        ) : (
          <Text as="span" tone="muted">
            {t("progress.of", { total: knownTotal })}
          </Text>
        )}

        <Button onClick={submit} disabled={!valid || pending}>
          {t("progress.action")}
        </Button>
      </Row>
    </CardSection>
  );
}
