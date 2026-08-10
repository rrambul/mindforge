import { useTranslation } from "react-i18next";
import { Select } from "../../../shared/ui/index.js";

/** What a block can be about. One of these, or nothing. */
export interface SessionSubject {
  readonly kind: "mission";
  readonly id: string;
  readonly label: string;
}

interface SubjectPickerProps {
  readonly subjects: readonly SessionSubject[];
  readonly value: string;
  readonly onChange: (key: string) => void;
  /**
   * Which phrasing to label it with. Both capture paths can be on screen at once — Today shows the
   * timer above the past-session form — and two controls with the same accessible name is a real
   * problem for anyone navigating by label, not just an aesthetic one. The retroactive form asks in
   * the past tense, which is what it means anyway.
   */
  readonly tense?: "present" | "past";
}

/**
 * What a session was about — the control that makes the time tracker mean something.
 *
 * Shared by both capture paths, and it has to be: `focus_sessions.mission_id` was written by
 * nothing until M2 was reviewed, so a user could log every session and watch every mission report
 * 0m. Fixing only the timer would have left the same hole on retroactive entry, which is the path
 * FR-F2 exists for — "you *will* forget the timer", and work done away from the app arrives that
 * way or not at all.
 *
 * Pre-selected to nothing, so neither path costs an extra tap unless you want one (§7.1).
 */
export function SubjectPicker({
  subjects,
  value,
  onChange,
  tense = "present",
}: SubjectPickerProps) {
  const { t } = useTranslation("focus");

  // Absent rather than empty on a new account: a picker with nothing in it is a control that teaches
  // you the feature is broken.
  if (subjects.length === 0) return null;

  return (
    <Select
      label={t(tense === "past" ? "past.subject" : "start.subject")}
      hint={t("start.subjectHint")}
      name="subject"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "", label: t("start.subjectNone") },
        ...subjects.map((subject) => ({
          value: subjectKey(subject),
          label: `${t(`start.subjectGroup.${subject.kind}`)} · ${subject.label}`,
        })),
      ]}
    />
  );
}

/** Kind and id together: a mission and a skill can hold the same uuid across two tables. */
export function subjectKey(subject: SessionSubject): string {
  return `${subject.kind}:${subject.id}`;
}

/** The chosen subject, or null. Kept here so both callers resolve a key the same way. */
export function findSubject(
  subjects: readonly SessionSubject[],
  key: string,
): SessionSubject | null {
  return subjects.find((subject) => subjectKey(subject) === key) ?? null;
}

/** The request fields a subject contributes, or nothing when none was chosen. */
export function subjectFields(subject: SessionSubject | null): { missionId?: string } {
  return subject === null ? {} : { missionId: subject.id };
}
