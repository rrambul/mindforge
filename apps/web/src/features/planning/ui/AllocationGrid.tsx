import { MAX_PLANNED_MINUTES } from "@mindforge/core";
import { useTranslation } from "react-i18next";
import { Field, Label, Stack, Text } from "../../../shared/ui/index.js";
import { subjectKey, type PlanSubjectOption } from "../model/allocation-draft.js";
import "./planning.css";

/**
 * The week's targets, one box per thing you could work on (FR-F5).
 *
 * Dumb by design (§2.2 rule 5): it holds no state, reads nothing, and cannot tell a value that came
 * from the server from one you just typed. That is what lets the route keep only the dirty edits and
 * merge them over the query cache instead of copying a week into `useState`.
 *
 * **Missions and skills are separate groups**, not one alphabetical list. They are different kinds of
 * commitment — a mission is what you are doing, a skill is what you are getting better at — and
 * interleaving them makes the grid a list of names you have to re-read every week.
 */
export interface AllocationGridProps {
  readonly subjects: readonly PlanSubjectOption[];
  /** The text for one row's box, resolved by the route from its draft and the stored week. */
  readonly valueFor: (key: string) => string;
  readonly onChange: (key: string, raw: string) => void;
  /** Boxes that cannot be sent. Marked here, explained once above the grid. */
  readonly invalidKeys: readonly string[];
  readonly disabled?: boolean;
}

export function AllocationGrid({
  subjects,
  valueFor,
  onChange,
  invalidKeys,
  disabled = false,
}: AllocationGridProps) {
  const { t } = useTranslation("planning");

  const missions = subjects.filter((subject) => subject.kind === "mission");
  const skills = subjects.filter((subject) => subject.kind === "skill");

  return (
    <Stack>
      {missions.length === 0 ? null : (
        <Group
          caption={t("grid.missions")}
          subjects={missions}
          valueFor={valueFor}
          onChange={onChange}
          invalidKeys={invalidKeys}
          disabled={disabled}
        />
      )}
      {skills.length === 0 ? null : (
        <Group
          caption={t("grid.skills")}
          subjects={skills}
          valueFor={valueFor}
          onChange={onChange}
          invalidKeys={invalidKeys}
          disabled={disabled}
        />
      )}
    </Stack>
  );
}

function Group({
  caption,
  subjects,
  valueFor,
  onChange,
  invalidKeys,
  disabled,
}: AllocationGridProps & { readonly caption: string }) {
  const { t } = useTranslation("planning");

  return (
    <Stack gap="tight">
      <Label>{caption}</Label>
      {/* The unit is said once for the group rather than in every label: repeating "minutes" beside
          twelve mission topics is noise, and it is the same answer every time. */}
      <Text tone="hint">{t("grid.unitHint")}</Text>
      <div className="mf-plan-grid">
        {subjects.map((subject) => {
          const key = subjectKey(subject);
          return (
            <Field
              key={key}
              label={subject.label}
              width="short"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_PLANNED_MINUTES}
              step={5}
              disabled={disabled}
              value={valueFor(key)}
              // Clearing the box is how a row is removed — see `readDraftEntry`. The empty string
              // has to reach the draft as an edit, which is why this is not guarded.
              onChange={(event) => onChange(key, event.target.value)}
              error={
                invalidKeys.includes(key)
                  ? t("grid.outOfRange", { max: MAX_PLANNED_MINUTES })
                  : undefined
              }
            />
          );
        })}
      </div>
    </Stack>
  );
}
