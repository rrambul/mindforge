import type { CompleteWeeklyReviewInput } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatInstant } from "../../../shared/lib/format.js";
import {
  Button,
  Callout,
  Field,
  Row,
  Stack,
  Text,
  TextareaField,
} from "../../../shared/ui/index.js";
import type { WeeklyReviewView } from "../api/use-planning.js";

/**
 * The one thing you are changing (FR-F6) — the field NORTHSTAR.md §4's finish line is written in:
 * "you've done three weekly reviews and changed one thing because of one".
 *
 * **Optional, and it stays optional.** A week where nothing needs changing is a real answer, and a
 * required field would produce a fabricated one — which is the reflex §7.2 exists to prevent, and
 * would poison the only record of whether the ritual is doing anything.
 *
 * **Server state is not copied into `useState`.** Only the fields you have touched live here; an
 * untouched field reads through to the stored review at every render. Seeding state from the query
 * on mount would mean a revision submitted in another tab, or a refetch after a save, silently lost
 * to a value captured once.
 */
export interface ReviewFormProps {
  /** The stored review, when this week has been reviewed before. Submitting again revises it. */
  readonly existing: WeeklyReviewView | undefined;
  readonly timeZone: string;
  readonly pending: boolean;
  /** Already translated by the route. */
  readonly error: string | null;
  readonly onSubmit: (input: CompleteWeeklyReviewInput) => void;
}

type Touched = Readonly<Record<"changedOneThing" | "note", string | undefined>>;

export function ReviewForm({ existing, timeZone, pending, error, onSubmit }: ReviewFormProps) {
  const { t, i18n } = useTranslation("planning");
  const [touched, setTouched] = useState<Touched>({ changedOneThing: undefined, note: undefined });

  // `??` and not `||`: clearing a field produces "", which is a deliberate erasure and must not fall
  // back to the stored sentence.
  const changedOneThing = touched.changedOneThing ?? existing?.changedOneThing ?? "";
  const note = touched.note ?? existing?.note ?? "";

  function submit(): void {
    onSubmit({
      // Empty means "nothing to record", and the column is nullable precisely so that stays a
      // legitimate answer. Sent as null rather than omitted, so clearing a sentence you wrote last
      // week actually clears it.
      changedOneThing: changedOneThing.trim() === "" ? null : changedOneThing.trim(),
      note: note.trim() === "" ? null : note.trim(),
    });
  }

  return (
    <Stack>
      <Field
        label={t("review.changedOneThing")}
        hint={t("review.changedOneThingHint")}
        maxLength={280}
        value={changedOneThing}
        disabled={pending}
        onChange={(event) =>
          setTouched((current) => ({ ...current, changedOneThing: event.target.value }))
        }
      />
      <TextareaField
        label={t("review.note")}
        rows={3}
        maxLength={2000}
        value={note}
        disabled={pending}
        onChange={(event) => setTouched((current) => ({ ...current, note: event.target.value }))}
      />

      {error === null ? null : (
        <Callout tone="danger" live>
          {error}
        </Callout>
      )}

      <Row>
        {/* The screen's one primary action. Everything else on it is a link. */}
        <Button variant="primary" onClick={submit} disabled={pending}>
          {existing === undefined ? t("review.complete") : t("review.revise")}
        </Button>
      </Row>

      {/* When the ritual happened, not when it was last edited — the API is careful about the
          difference, so the screen is too. This is the only honest confirmation there is: there is
          no success tone in `Callout`, by design. */}
      {existing === undefined ? null : (
        <Text tone="muted">
          {t("review.completedAt", {
            when: formatInstant(existing.completedAt, i18n.language, timeZone),
          })}
        </Text>
      )}
    </Stack>
  );
}
