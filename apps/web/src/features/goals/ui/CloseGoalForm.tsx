import type { CloseGoalInput } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Row, Select, Stack, TextareaField } from "../../../shared/ui/index.js";

type Ending = "met" | "missed" | "abandoned";

interface CloseGoalFormProps {
  readonly onClose: (body: CloseGoalInput) => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
}

/**
 * Closing a goal, including missing one.
 *
 * "Missed it" and "Dropped it" sit beside "Met it" as equals, with no softening and no consolation —
 * a goal that is allowed to fail is a goal you will write down honestly next time, and a form that
 * flinched at the word would teach the opposite.
 *
 * The note is required for the two endings that are not "met", because what stopped you is the only
 * part anyone will want to read in three months. It is optional for "met", which usually speaks for
 * itself.
 */
export function CloseGoalForm({ onClose, onCancel, pending }: CloseGoalFormProps) {
  const { t } = useTranslation("goals");
  const [status, setStatus] = useState<Ending>("met");
  const [note, setNote] = useState("");

  const trimmed = note.trim();
  const noteRequired = status !== "met";
  const canSubmit = !noteRequired || trimmed !== "";

  return (
    <Stack>
      <Select
        label={t("close.status")}
        value={status}
        onChange={(event) => setStatus(event.target.value as Ending)}
        options={[
          { value: "met", label: t("close.met") },
          { value: "missed", label: t("close.missed") },
          { value: "abandoned", label: t("close.abandoned") },
        ]}
      />

      <TextareaField
        label={t("close.note")}
        {...(noteRequired ? { hint: t("close.noteRequired") } : {})}
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <Row>
        <Button
          variant="primary"
          disabled={!canSubmit || pending}
          onClick={() => onClose({ status, ...(trimmed === "" ? {} : { outcomeNote: trimmed }) })}
        >
          {t("close.confirm")}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t("close.cancel")}
        </Button>
      </Row>
    </Stack>
  );
}
