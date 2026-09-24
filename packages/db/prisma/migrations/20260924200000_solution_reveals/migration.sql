-- Opening the reference solution is help, and is recorded as help.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why).
--
-- A code review found that "Show solution" was recorded nowhere: a learner could
-- open it, paste it, pass on the first try, and the lesson read "too easy" — while
-- a rung-5 hint, which shows less, counted as heavy help. So a reveal is a row in
-- `exercise_hints` with `kind = 'solution'`, at the top rung, and everything that
-- reads hints (`lessonStrain`'s `highestHintBeforePass`, the attempt summary)
-- counts it without knowing it is special.

ALTER TABLE "exercise_hints" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'hint';

ALTER TABLE "exercise_hints" ADD CONSTRAINT "exercise_hints_kind_known"
  CHECK ("kind" IN ('hint', 'solution'));

-- A reveal is the top rung, answers no question, and costs nothing: it shows what
-- the lesson already declared. `answer` keeps what was shown, as a record.
ALTER TABLE "exercise_hints" ADD CONSTRAINT "exercise_hints_solution_shape"
  CHECK ("kind" = 'hint' OR ("level" = 5 AND "question" IS NULL AND "llm_call_id" IS NULL));
