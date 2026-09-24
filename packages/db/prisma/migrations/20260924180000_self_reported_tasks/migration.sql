-- Self-reported results for `task` exercises — code run on the learner's machine.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why).
--
-- A third grader beside `tests` and `review`: `self`, the learner's own word that
-- they ran the command and the tests passed or did not. It is recorded as exactly
-- that, so nothing downstream can mistake it for a run the app checked — the
-- screen says "you reported", and a reader of this table can tell the difference
-- without knowing which exercise kinds exist.

ALTER TABLE "exercise_attempts" DROP CONSTRAINT "exercise_attempts_graded_by_known";
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_graded_by_known"
  CHECK ("graded_by" IN ('tests', 'review', 'self'));

-- A self-report is one result — "the tests passed" or not — so `passed` and the
-- counts must agree the way `exercise_attempts_passed_means_all` already makes
-- them agree for every grader.
