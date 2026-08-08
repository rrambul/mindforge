import {
  MAX_PLANNED_MINUTES,
  type AllocationInput,
  type PlanSubject,
  type PutWeeklyPlanInput,
} from "@mindforge/core";
import type { AllocationView } from "../api/use-planning.js";

/**
 * The planning grid's edit model (FR-F5).
 *
 * The API replaces a whole week in one PUT, so the grid has to be edited as a set and saved as one
 * value. The obvious way to do that is to copy the week's allocations into `useState` on load and
 * edit the copy — which is §2.2 rule 1's single biggest cause of unmaintainable React, and here it
 * is not merely untidy: a refetch after a save, or a plan changed in another tab, would be silently
 * discarded by a state that was seeded once and never asked again.
 *
 * **So only the dirty edits are local.** `Draft` holds the fields you have actually touched, keyed by
 * subject, as the raw strings you typed. Everything else is read from the query cache at render, and
 * a saved draft is emptied rather than reconciled. The consequence worth stating: an untouched row
 * follows the server, and a touched one does not until you save or discard.
 */

/** A row in the grid: a thing minutes can be allocated to, with the name to draw beside the box. */
export interface PlanSubjectOption {
  readonly kind: PlanSubject["kind"];
  readonly id: string;
  readonly label: string;
}

/** Subject → the raw text in that row's box. `""` is a real value: it means "no allocation". */
export type Draft = Readonly<Record<string, string>>;

/** The same composite the API's `subjectKey` builds, so a row and an allocation can be matched. */
export function subjectKey(subject: { kind: PlanSubject["kind"]; id: string }): string {
  return `${subject.kind}:${subject.id}`;
}

function allocationKey(allocation: AllocationView): string {
  return allocation.missionId === null
    ? `skill:${allocation.skillId ?? ""}`
    : `mission:${allocation.missionId}`;
}

/**
 * What a row's box should contain: your edit if you made one, otherwise the week as it is stored.
 *
 * `key in draft` rather than a truthiness check — clearing a field produces `""`, which is the whole
 * way "remove this allocation" is expressed, and `draft[key] || stored` would helpfully undo it.
 */
export function draftValue(
  key: string,
  draft: Draft,
  allocations: readonly AllocationView[] | undefined,
): string {
  if (key in draft) return draft[key] ?? "";
  const stored = allocations?.find((allocation) => allocationKey(allocation) === key);
  return stored === undefined ? "" : String(stored.plannedMinutes);
}

export type DraftEntry =
  | { readonly state: "empty" }
  | { readonly state: "minutes"; readonly minutes: number }
  | { readonly state: "invalid" };

/**
 * One box, read.
 *
 * **Zero is `empty`, not a value.** `AllocationSchema` refuses it — "zero is the absence of an
 * allocation rather than an allocation of nothing" — so a row typed as 0 has to become a removed row
 * rather than a 422 the user cannot act on. Anything else out of range is `invalid` and blocks the
 * save with a message, because silently clamping a mistyped 6000 to the ceiling would plan a week
 * nobody asked for.
 */
export function readDraftEntry(raw: string): DraftEntry {
  const trimmed = raw.trim();
  if (trimmed === "") return { state: "empty" };

  const minutes = Number(trimmed);
  if (!Number.isInteger(minutes) || minutes < 0) return { state: "invalid" };
  if (minutes === 0) return { state: "empty" };
  if (minutes > MAX_PLANNED_MINUTES) return { state: "invalid" };

  return { state: "minutes", minutes };
}

export interface DraftSummary {
  /** The body to PUT, in the grid's own order. */
  readonly body: PutWeeklyPlanInput;
  readonly plannedTotal: number;
  /** Subject keys whose boxes cannot be sent. Empty means the grid is savable. */
  readonly invalidKeys: readonly string[];
  /** Whether anything at all differs from the stored week. */
  readonly dirty: boolean;
}

/** `PutWeeklyPlanSchema` caps a week at 50 allocations; past that the server refuses the lot. */
export const MAX_ALLOCATIONS = 50;

/**
 * The whole grid, read as one value — which is what the endpoint takes.
 *
 * Rows are emitted in the order they are drawn rather than sorted by minutes: the response comes back
 * sorted by the server anyway, and re-ordering the payload would only make a diff harder to read.
 */
export function readDraft(
  subjects: readonly PlanSubjectOption[],
  draft: Draft,
  allocations: readonly AllocationView[] | undefined,
): DraftSummary {
  const rows: AllocationInput[] = [];
  const invalidKeys: string[] = [];
  let plannedTotal = 0;

  for (const subject of subjects) {
    const key = subjectKey(subject);
    const entry = readDraftEntry(draftValue(key, draft, allocations));

    if (entry.state === "invalid") {
      invalidKeys.push(key);
      continue;
    }
    if (entry.state === "empty") continue;

    plannedTotal += entry.minutes;
    rows.push(
      // exactOptionalPropertyTypes: the unused id is omitted rather than sent as undefined, and
      // `AllocationSchema` refuses a body naming both.
      subject.kind === "mission"
        ? { missionId: subject.id, plannedMinutes: entry.minutes }
        : { skillId: subject.id, plannedMinutes: entry.minutes },
    );
  }

  return {
    body: { allocations: rows },
    plannedTotal,
    invalidKeys,
    dirty: isDirty(subjects, draft, allocations),
  };
}

/**
 * Whether the grid says anything the stored week does not.
 *
 * Compared through `readDraftEntry` on both sides rather than by string: typing `060` into a box
 * holding `60` is a change to the text and not to the plan, and offering to save it would train you
 * to press a button that does nothing.
 */
function isDirty(
  subjects: readonly PlanSubjectOption[],
  draft: Draft,
  allocations: readonly AllocationView[] | undefined,
): boolean {
  return subjects.some((subject) => {
    const key = subjectKey(subject);
    if (!(key in draft)) return false;

    const edited = readDraftEntry(draft[key] ?? "");
    const stored = readDraftEntry(draftValue(key, {}, allocations));

    if (edited.state !== stored.state) return true;
    return (
      edited.state === "minutes" && stored.state === "minutes" && edited.minutes !== stored.minutes
    );
  });
}

/**
 * Allocations the grid has no row for.
 *
 * A mission parked after the week was planned still has its allocation, and so does a skill you
 * deleted. Neither can be drawn — the row list is built from what exists now — and neither would
 * survive the next save, because the PUT sends only what the grid holds. Named so the screen can say
 * that out loud instead of letting a target vanish on the first press of Save.
 */
export function orphanedAllocations(
  subjects: readonly PlanSubjectOption[],
  allocations: readonly AllocationView[] | undefined,
): readonly AllocationView[] {
  if (!allocations) return [];
  const known = new Set(subjects.map(subjectKey));
  return allocations.filter((allocation) => !known.has(allocationKey(allocation)));
}
