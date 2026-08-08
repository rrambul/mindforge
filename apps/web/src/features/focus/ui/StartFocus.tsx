import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Row, Stack } from "../../../shared/ui/index.js";
import { findSubject, SubjectPicker, type SessionSubject } from "./SubjectPicker.js";

export interface StartFocusProps {
  readonly onStart: (intention: string | null, subject: SessionSubject | null) => void;
  readonly starting: boolean;
  /** Active missions, then skills, then whatever you are part-way through. Empty is fine. */
  readonly subjects: readonly SessionSubject[];
}

/**
 * Today's one primary action (§5.3): get into a focus session in one tap.
 *
 * The intention field is present but never required. §5.3 asks one question at start — "what does
 * done look like for this block?" — and a question you cannot skip is a question that stops you
 * starting. Submitting it empty is a supported path, not a validation failure.
 *
 * The subject picker is optional for the same reason and pre-selected to nothing, so Enter still
 * starts a session from the intention field alone. Why it exists at all is in `SubjectPicker`.
 */
export function StartFocus({ onStart, starting, subjects }: StartFocusProps) {
  const { t } = useTranslation("focus");
  const [intention, setIntention] = useState("");
  const [subjectKey, setSubjectKey] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = intention.trim();
    onStart(trimmed === "" ? null : trimmed, findSubject(subjects, subjectKey));
    setIntention("");
    // The subject is deliberately kept. Consecutive blocks are usually on the same thing, and
    // clearing it would make the common case cost the extra tap every time.
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <Field
          label={t("start.intention")}
          hint={t("start.intentionHint")}
          name="intention"
          value={intention}
          onChange={(event) => setIntention(event.target.value)}
          // So a phone keyboard offers "go" rather than a newline: this is a one-field form and
          // Enter should start the session.
          enterKeyHint="go"
        />

        <SubjectPicker subjects={subjects} value={subjectKey} onChange={setSubjectKey} />

        <Row>
          <Button variant="primary" type="submit" disabled={starting}>
            {starting ? t("start.starting") : t("start.submit")}
          </Button>
        </Row>
      </Stack>
    </form>
  );
}
