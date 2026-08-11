-- `agent_runs.kind` allows what this product actually runs — FR-K1, NORTHSTAR M4.
--
-- Two bugs in one constraint, both invisible until something tried to write the
-- value.
--
-- **`generate_curriculum` was never allowed.** `schema.prisma` has documented the
-- column as `generate_lesson | generate_curriculum | sync_workspace` since M3, and
-- `20260809120000_curriculum_tracks` wrote a comment on `agent_runs.track_id`
-- explaining that it is null "for curriculum runs" — but the CHECK from
-- `20260808120000_teach_workspace` never listed the value. Nothing noticed,
-- because nothing dispatched one: the endpoint hardcoded `generate_lesson` and
-- `writeCurriculumPlugin` was built and tested with no caller. The first press of
-- the button that plans a curriculum is what found it, as a 23514 surfacing as a
-- 400.
--
-- **Four kinds outlived their features.** `generate_assessment`, `grade_teach_back`
-- and `weekly_digest` belonged to the assessment and weekly-review milestones, and
-- `generate_plan` to weekly planning. All were cut in v0.2 (`NORTHSTAR.md` §5) and
-- `20260810120000_refocus_curriculum_flow` dropped their tables without narrowing
-- this list — so the constraint has been documenting a product that no longer
-- exists. They come back with the features, in the migration that brings them.
--
-- No data moves: `generate_lesson` is the only kind any row has ever held, checked
-- before writing this. A row using one of the four would fail the migration rather
-- than be deleted, which is the right way round — losing a run's history to a
-- constraint change is not a trade this project makes.

ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_kind_known";

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_kind_known"
  CHECK ("kind" IN ('generate_lesson', 'generate_curriculum', 'sync_workspace'));

COMMENT ON COLUMN "agent_runs"."kind" IS
  'generate_lesson | generate_curriculum | sync_workspace. Chosen by the API from whether the mission has modules (FR-K1), never by the client.';
