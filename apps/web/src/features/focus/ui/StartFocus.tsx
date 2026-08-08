import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Row, Select, Stack } from "../../../shared/ui/index.js";

/** What a block can be about. One of these, or nothing. */
export interface SessionSubject {
  readonly kind: "mission" | "skill" | "resource";
  readonly id: string;
  readonly label: string;
}

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
 * **The subject picker exists because plan-vs-actual could not work without it.** Until M2 was
 * reviewed, this form sent an intention and nothing else: `focus_sessions.mission_id` and
 * `skill_id` were written only by the API's own tests and by the seed. So a user could allocate four
 * hours to a mission on the weekly grid, log every one of them from this screen, and watch the
 * review report 0m — the plan and the actual had no way to meet. A schema column that no capture
 * path writes is the same failure M1 recorded about "notes on anything", one layer down.
 *
 * It stays inside the ≤5s, ≤2-tap budget (§7.1) by being **optional and pre-selected to nothing**:
 * Enter still starts a session from the intention field alone, and the picker is one tap when you
 * want it. Deliberately one control rather than three — a mission, a skill and a resource select
 * would be a form, and this screen has a budget.
 */
export function StartFocus({ onStart, starting, subjects }: StartFocusProps) {
  const { t } = useTranslation("focus");
  const [intention, setIntention] = useState("");
  const [subjectKey, setSubjectKey] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = intention.trim();
    onStart(
      trimmed === "" ? null : trimmed,
      subjects.find((subject) => keyOf(subject) === subjectKey) ?? null,
    );
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

        {/* Absent rather than empty on a new account: a picker with nothing in it is a control that
            teaches you the feature is broken. */}
        {subjects.length === 0 ? null : (
          <Select
            label={t("start.subject")}
            hint={t("start.subjectHint")}
            name="subject"
            value={subjectKey}
            onChange={(event) => setSubjectKey(event.target.value)}
            // Flat, with the kind spelled out in each label. `Select` takes options rather than
            // children, so `<optgroup>` is not available — and the kind matters here, because a
            // mission and a skill can carry the same name.
            options={[
              { value: "", label: t("start.subjectNone") },
              ...subjects.map((subject) => ({
                value: keyOf(subject),
                label: `${t(`start.subjectGroup.${subject.kind}`)} · ${subject.label}`,
              })),
            ]}
          />
        )}

        <Row>
          <Button variant="primary" type="submit" disabled={starting}>
            {starting ? t("start.starting") : t("start.submit")}
          </Button>
        </Row>
      </Stack>
    </form>
  );
}

/** Kind and id together: a mission and a skill can hold the same uuid across two tables. */
function keyOf(subject: SessionSubject): string {
  return `${subject.kind}:${subject.id}`;
}
