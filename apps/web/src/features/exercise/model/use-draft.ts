import { useCallback, useEffect, useState } from "react";

import { nowIso } from "../../../shared/lib/clock.js";
import { loadDraft, saveDraft, type Draft } from "./draft.js";
import type { CodeExerciseView } from "./kinds.js";

/** Long enough that typing is not a write per keystroke, short enough that a closed tab loses little. */
export const DRAFT_SAVE_DELAY_MS = 500;

/**
 * The editor's code, seeded and remembered.
 *
 * Seeded from the first of: this device's draft, the code from your last attempt,
 * the exercise's starter. The draft wins over the last attempt because it is newer
 * by construction — it is what you typed after that run.
 *
 * `startedAt` is set on the first edit away from the starter and kept from then on.
 * It is a lower bound on the effort, not a measurement of it: a learner who worked
 * on another device, or whose draft was cleared, starts the clock again here, and
 * the attempt says only what this browser saw.
 */
export function useDraft(
  lessonId: string,
  exercise: CodeExerciseView,
): {
  readonly draft: Draft;
  readonly setCode: (code: string) => void;
  readonly reset: () => void;
} {
  const [draft, setDraft] = useState<Draft>(
    () =>
      loadDraft(lessonId, exercise.key) ?? {
        code: exercise.attempts.lastCode ?? exercise.starter,
        startedAt: null,
      },
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(lessonId, exercise.key, draft);
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [lessonId, exercise.key, draft]);

  const setCode = useCallback(
    (code: string) => {
      setDraft((current) =>
        current.code === code
          ? current
          : {
              code,
              startedAt: current.startedAt ?? (code === exercise.starter ? null : nowIso()),
            },
      );
    },
    [exercise.starter],
  );

  const reset = useCallback(() => {
    // Back to the starter, but not back to "never started": you did.
    setDraft((current) => ({ code: exercise.starter, startedAt: current.startedAt }));
  }, [exercise.starter]);

  return { draft, setCode, reset };
}
