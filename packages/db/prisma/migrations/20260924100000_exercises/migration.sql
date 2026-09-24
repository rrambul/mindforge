-- Exercises: something the learner does inside a lesson — FR-X1–X6,
-- PLAN-HANDS-ON.md Phase 1.
--
-- Hand-written, like every migration after the initial one (see
-- 20260810180000_focus_session_lesson for why `prisma migrate dev` cannot run).
--
-- Two halves with different owners, which is why they are not one table:
--
-- * **What the exercise is** comes from the lesson file, so it is index. It lands
--   on the lesson's own row as `exercises`, rewritten by every reindex from the
--   file's `<script type="application/vnd.mindforge.exercise+json">` blocks.
-- * **What you did with it** has no file. `exercise_attempts` is the only copy,
--   like `lessons.completed_at`, and it is keyed by the lesson and the exercise's
--   own `key` — an exercise row would be rebuilt, and its id changed, by every
--   reindex, taking the attempts' foreign key with it.

ALTER TABLE "lessons" ADD COLUMN "exercises" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- An array or nothing: the reader maps over it, and a stray object here would be
-- a lesson that 500s on open rather than one with no exercises.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_exercises_is_array"
  CHECK (jsonb_typeof("exercises") = 'array');

COMMENT ON COLUMN "lessons"."exercises" IS
  'ExerciseDeclaration[] from the lesson file (FR-X1). Index: rebuilt on every sync, never edited here.';

CREATE TABLE "exercise_attempts" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID        NOT NULL,
  "lesson_id"    UUID        NOT NULL,
  "exercise_key" TEXT        NOT NULL,
  "code"         TEXT        NOT NULL,
  "status"       TEXT        NOT NULL,
  "results"      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "tests_passed" INTEGER     NOT NULL,
  "tests_total"  INTEGER     NOT NULL,
  "passed"       BOOLEAN     NOT NULL,
  "started_at"   TIMESTAMPTZ(6),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "exercise_attempts_pkey" PRIMARY KEY ("id"),
  -- The same shape `ExerciseKeySchema` enforces, so a key written around the API
  -- still cannot be one the URL could not carry.
  CONSTRAINT "exercise_attempts_key_shape"
    CHECK ("exercise_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("exercise_key") <= 80),
  CONSTRAINT "exercise_attempts_code_size" CHECK (length("code") <= 50000),
  CONSTRAINT "exercise_attempts_status"
    CHECK ("status" IN ('completed', 'error', 'timeout')),
  CONSTRAINT "exercise_attempts_results_is_array" CHECK (jsonb_typeof("results") = 'array'),
  CONSTRAINT "exercise_attempts_counts"
    CHECK ("tests_passed" >= 0 AND "tests_total" >= 0 AND "tests_passed" <= "tests_total"),
  -- `attemptPassed` in packages/core is the rule; this is the part of it the
  -- database can see. A pass with a failing test, or with no tests, is a row that
  -- would make "first passed" lie.
  CONSTRAINT "exercise_attempts_passed_means_all"
    CHECK (NOT "passed" OR ("status" = 'completed' AND "tests_total" > 0 AND "tests_passed" = "tests_total"))
);

-- Cascade both ways: an attempt means nothing without the lesson it was on, and a
-- deleted account takes everything (FR-A4).
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every read is "this user's attempts at this exercise, in order".
CREATE INDEX "exercise_attempts_user_id_lesson_id_exercise_key_created_at_idx"
  ON "exercise_attempts"("user_id", "lesson_id", "exercise_key", "created_at");

-- ============================================================================
-- Row-level security.
--
-- Owner-only, like every table. The WITH CHECK has a second half the other tables
-- do not need: `user_id = auth.uid()` proves the row is yours, not that the lesson
-- it names is. Without the lesson check, a learner who guessed another user's
-- lesson id could hang attempts off it — invisible to that user, since RLS hides
-- the row, but a foreign key into their data that the cascade would then follow.
--
-- No UPDATE policy: attempts are append-only (see schema.prisma). DELETE is
-- allowed for the owner so account-level cleanup and a future "clear my
-- attempts" do not need the service role.
-- ============================================================================

ALTER TABLE "exercise_attempts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercise_attempts_owner_select" ON "exercise_attempts"
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "exercise_attempts_owner_insert" ON "exercise_attempts"
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_id AND l.user_id = auth.uid())
  );

CREATE POLICY "exercise_attempts_owner_delete" ON "exercise_attempts"
  FOR DELETE USING (user_id = auth.uid());
