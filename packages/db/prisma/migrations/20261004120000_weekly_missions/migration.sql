-- Missions planned in weeks — FR-B1–B7, PLAN-WEEKS.md, TECH-DESIGN §3.2d.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why `prisma migrate
-- dev` cannot run here).
--
-- Two stored facts and everything else derived: how many weeks, and the day the
-- first one starts. Week k's dates, each lesson's day and the exam day are
-- arithmetic over those and the plan's order (`schedule/weeks.ts` in
-- packages/core), never columns.

ALTER TABLE "missions" ADD COLUMN "weeks" SMALLINT;
-- A calendar day in the learner's timezone (FR-U6), never an instant.
ALTER TABLE "missions" ADD COLUMN "starts_on" DATE;

-- Both or neither. A mission created before this change has no calendar and keeps
-- working without one; a mission with a length and no start, or a start and no
-- length, is a calendar nobody can draw.
--
-- Written without OR-of-ANDs on purpose: with `weeks` null, `weeks BETWEEN 1 AND
-- 52` is NULL rather than false, a NULL check passes, and a start with no length
-- slipped through the first draft of this constraint. Both halves here are plain
-- booleans.
ALTER TABLE "missions" ADD CONSTRAINT "missions_calendar_shape"
  CHECK (("weeks" IS NULL) = ("starts_on" IS NULL)
         AND ("weeks" IS NULL OR "weeks" BETWEEN 1 AND 52));

COMMENT ON COLUMN "missions"."weeks" IS
  'One module per week, five lessons and an exam in each (FR-B1, FR-B2). Null for a mission created before weeks.';
COMMENT ON COLUMN "missions"."starts_on" IS
  'The first day of week 1: a week start in the learner''s profile. Fixed at creation (FR-B4).';

-- ============================================================================
-- module_deadlines goes.
--
-- Committed, pace-proposed module deadlines (FR-U2) were replaced two days after
-- they shipped by the calendar above: a module's deadline is its week's exam day,
-- derived rather than committed (PLAN-WEEKS.md, decision 3). No real deadline was
-- ever written outside a seed and a test. Its policies and index go with it.
-- ============================================================================

DROP TABLE "module_deadlines";
