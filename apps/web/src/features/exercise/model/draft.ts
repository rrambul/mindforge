import { z } from "zod";

/**
 * The code you have not run yet, kept in this browser (FR-X3).
 *
 * `localStorage` rather than the server because it is a per-device convenience,
 * not a record: what the product records is an *attempt*, and an attempt is a run.
 * A draft that reached the server would be a second, unrun copy of your code
 * competing with the one the attempt history describes.
 *
 * **Every access can throw.** A private window, blocked site data, a full quota —
 * each makes `localStorage` throw on read or write, and a panel that crashed with
 * it would lose the exercise over a convenience. So every call is wrapped, and the
 * worst case is that the draft is not remembered.
 */

const DraftSchema = z.object({
  code: z.string(),
  /** When the learner first changed the starter. Null until they have. */
  startedAt: z.iso.datetime().nullable(),
});
export type Draft = z.infer<typeof DraftSchema>;

export function draftKey(lessonId: string, exerciseKey: string): string {
  return `mindforge:exercise-draft:${lessonId}:${exerciseKey}`;
}

export function loadDraft(lessonId: string, exerciseKey: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(lessonId, exerciseKey));
    if (raw === null) return null;
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft(lessonId: string, exerciseKey: string, draft: Draft): void {
  try {
    window.localStorage.setItem(draftKey(lessonId, exerciseKey), JSON.stringify(draft));
  } catch {
    // Not remembered on this device. The code is still in the editor.
  }
}
