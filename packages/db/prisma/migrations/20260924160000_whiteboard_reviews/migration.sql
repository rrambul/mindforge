-- Whiteboard reviews — FR-X7–X9, PLAN-HANDS-ON.md Phase 4.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why).
--
-- A review is an attempt. Its results are the rubric, item by item, which is what
-- lets every reader of attempts — the summary, `lessonStrain`, adaptation — treat a
-- drawn design exactly as it treats code, with no second path to keep in step. What
-- differs is recorded rather than implied:
--
-- * `graded_by` says who decided "passed". A test run's results come from the
--   learner's browser; a review's come from a model reading the drawing. Those are
--   different kinds of evidence, and a row that did not say which would let one
--   pass for the other.
-- * `scene` is what was drawn, so the canvas resumes and the review can be re-read
--   against what it saw.
-- * `feedback` is the reviewer's one overall sentence.
-- * `llm_call_id` is the bill (non-negotiable 9), like `exercise_hints.llm_call_id`.

ALTER TABLE "exercise_attempts" ADD COLUMN "graded_by" TEXT NOT NULL DEFAULT 'tests';
ALTER TABLE "exercise_attempts" ADD COLUMN "scene" JSONB;
ALTER TABLE "exercise_attempts" ADD COLUMN "feedback" TEXT;
ALTER TABLE "exercise_attempts" ADD COLUMN "llm_call_id" UUID;

ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_graded_by_known"
  CHECK ("graded_by" IN ('tests', 'review'));

-- A review always has the drawing it reviewed; a test run never has one.
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_scene_means_review"
  CHECK (("graded_by" = 'review') = ("scene" IS NOT NULL));

-- An array of canvas elements, and bounded: a drawing is kilobytes, and a row that
-- held megabytes would be a learner's history nobody could page through.
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_scene_shape"
  CHECK ("scene" IS NULL OR (jsonb_typeof("scene") = 'array' AND pg_column_size("scene") <= 2000000));

ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_feedback_shape"
  CHECK ("feedback" IS NULL OR ("graded_by" = 'review' AND length("feedback") BETWEEN 1 AND 1000));

ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_llm_call_id_fkey"
  FOREIGN KEY ("llm_call_id") REFERENCES "llm_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No policy change: RLS is per row, and these are columns of a row whose policies
-- already check the owner and the lesson.
