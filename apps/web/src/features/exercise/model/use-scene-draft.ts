import type { SceneElement } from "@mindforge/core";
import { useCallback, useEffect, useState } from "react";

import { nowIso } from "../../../shared/lib/clock.js";
import type { WhiteboardExerciseView } from "./kinds.js";
import { loadSceneDraft, saveSceneDraft, type SceneDraft } from "./scene-draft.js";

/** Longer than the code draft's: a drag emits a change per frame, and a scene is larger to write. */
export const SCENE_DRAFT_SAVE_DELAY_MS = 1_000;

/**
 * The canvas, seeded and remembered — the whiteboard's `useDraft`.
 *
 * Seeded from the first of: this device's draft, the drawing from your last
 * review, an empty canvas. `startedAt` is set on the first real edit and kept, and
 * is a lower bound on the effort for the reason `useDraft` gives.
 */
export function useSceneDraft(
  lessonId: string,
  exercise: WhiteboardExerciseView,
): {
  readonly draft: SceneDraft;
  readonly setElements: (elements: SceneElement[]) => void;
} {
  const [draft, setDraft] = useState<SceneDraft>(
    () =>
      loadSceneDraft(lessonId, exercise.key) ?? {
        elements: [...(exercise.attempts.lastScene ?? [])],
        startedAt: null,
      },
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      saveSceneDraft(lessonId, exercise.key, draft);
    }, SCENE_DRAFT_SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [lessonId, exercise.key, draft]);

  const setElements = useCallback((elements: SceneElement[]) => {
    setDraft((current) => ({ elements, startedAt: current.startedAt ?? nowIso() }));
  }, []);

  return { draft, setElements };
}
