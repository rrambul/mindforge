import { SceneElementSchema, type SceneElement } from "@mindforge/core";
import { z } from "zod";

/**
 * The drawing you have not submitted yet, kept in this browser (FR-X7).
 *
 * The same arrangement as the code draft (`draft.ts`), for the same reasons: a
 * per-device convenience rather than a record — what the product records is a
 * review — and every access wrapped, because `localStorage` throws in a private
 * window or on a full quota, and a scene is the thing most likely to fill one.
 */

const SceneDraftSchema = z.object({
  elements: z.array(SceneElementSchema),
  /** When the learner first changed the canvas. Null until they have. */
  startedAt: z.iso.datetime().nullable(),
});
export type SceneDraft = z.infer<typeof SceneDraftSchema>;

export function sceneDraftKey(lessonId: string, exerciseKey: string): string {
  return `mindforge:whiteboard-draft:${lessonId}:${exerciseKey}`;
}

export function loadSceneDraft(lessonId: string, exerciseKey: string): SceneDraft | null {
  try {
    const raw = window.localStorage.getItem(sceneDraftKey(lessonId, exerciseKey));
    if (raw === null) return null;
    const parsed = SceneDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveSceneDraft(lessonId: string, exerciseKey: string, draft: SceneDraft): void {
  try {
    window.localStorage.setItem(sceneDraftKey(lessonId, exerciseKey), JSON.stringify(draft));
  } catch {
    // Not remembered on this device. The drawing is still on the canvas.
  }
}

export type { SceneElement };
