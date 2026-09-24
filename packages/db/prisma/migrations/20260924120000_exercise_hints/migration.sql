-- Hints: help when you are stuck, one rung at a time — FR-H1–H4,
-- PLAN-HANDS-ON.md Phase 2.
--
-- Hand-written, like every migration since the first (see
-- 20260810180000_focus_session_lesson for why).
--
-- A hint is learner data in the same sense an attempt is: there is no file behind
-- it, and it is the only record that the learner needed help — which is exactly
-- what Phase 3 has to know. "Passed" and "passed after being shown the code" are
-- different results, and without this table they would look the same.
--
-- Keyed like `exercise_attempts`, by the lesson and the exercise's own key, for the
-- same reason: an exercise has no row of its own that survives a reindex.

CREATE TABLE "exercise_hints" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID        NOT NULL,
  "lesson_id"    UUID        NOT NULL,
  "exercise_key" TEXT        NOT NULL,
  "level"        SMALLINT    NOT NULL,
  "question"     TEXT,
  "answer"       TEXT        NOT NULL,
  "llm_call_id"  UUID,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "exercise_hints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exercise_hints_key_shape"
    CHECK ("exercise_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("exercise_key") <= 80),
  -- `HINT_RUNGS` in packages/core: question, clue, concept, structure, code.
  CONSTRAINT "exercise_hints_level" CHECK ("level" BETWEEN 1 AND 5),
  CONSTRAINT "exercise_hints_question_size"
    CHECK ("question" IS NULL OR length("question") BETWEEN 1 AND 1000),
  -- A refused or empty answer is billed (it has an llm_calls row) but is not a
  -- hint, so it never lands here: the learner was not helped.
  CONSTRAINT "exercise_hints_answer_nonempty" CHECK (length("answer") > 0)
);

ALTER TABLE "exercise_hints" ADD CONSTRAINT "exercise_hints_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exercise_hints" ADD CONSTRAINT "exercise_hints_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, like `llm_calls.agent_run_id` in the other direction: the cost row and
-- the hint have separate lives, and neither deleting must take the other with it.
ALTER TABLE "exercise_hints" ADD CONSTRAINT "exercise_hints_llm_call_id_fkey"
  FOREIGN KEY ("llm_call_id") REFERENCES "llm_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "exercise_hints_user_id_lesson_id_exercise_key_created_at_idx"
  ON "exercise_hints"("user_id", "lesson_id", "exercise_key", "created_at");

-- ============================================================================
-- Row-level security — the same three policies as `exercise_attempts`, for the
-- same reasons: owner-only reads, an insert that checks the lesson as well as the
-- owner, append-only (no UPDATE policy), and owner delete.
-- ============================================================================

ALTER TABLE "exercise_hints" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercise_hints_owner_select" ON "exercise_hints"
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "exercise_hints_owner_insert" ON "exercise_hints"
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_id AND l.user_id = auth.uid())
  );

CREATE POLICY "exercise_hints_owner_delete" ON "exercise_hints"
  FOR DELETE USING (user_id = auth.uid());
