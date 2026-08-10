-- The v0.2 refocus — NORTHSTAR.md, REQUIREMENTS.md and TECH-DESIGN.md as of
-- 2026-08-10.
--
-- The product is now one flow: curriculum → modules → lessons → progress ·
-- time · frequency. Everything outside it goes: goals, skills and scoring,
-- the resource library, notes, friction tracking, weekly planning and
-- reviews, notifications, and the orphaned tasks table. The cut features'
-- code is removed in the same change; the data they held is dropped here.
--
-- Hand-written, like every migration after the initial one: `prisma migrate
-- dev` cannot introspect past the `profiles.id → auth.users.id` cross-schema
-- foreign key.
--
-- Deliberately NOT here: lessons.difficulty, lessons.depth, lessons.status
-- and lesson_edges. They are M4's schema (TECH-DESIGN.md §3.2b) and arrive
-- with the parser and the UI that write and read them — a column existing is
-- not evidence that anything writes it, and this codebase has been bitten by
-- exactly that shape twice (focus_sessions.mission_id in M2,
-- missions.workspace_key in M3).

-- ============================================================================
-- Columns first: the kept tables' references into the cut ones.
-- Dropping a column drops its foreign key, its indexes, and its check
-- constraints with it.
-- ============================================================================

ALTER TABLE "focus_sessions" DROP COLUMN "task_id";
ALTER TABLE "focus_sessions" DROP COLUMN "resource_id";
ALTER TABLE "focus_sessions" DROP COLUMN "skill_id";

-- The rollup keeps focus minutes and session count. Ember/slag were derived
-- from friction events; notes and resources counted tables that no longer
-- exist. Sums, not claims: the grid's intensity is minutes now, full stop.
ALTER TABLE "daily_activity" DROP COLUMN "ember_minutes";
ALTER TABLE "daily_activity" DROP COLUMN "slag_minutes";
ALTER TABLE "daily_activity" DROP COLUMN "notes_captured";
ALTER TABLE "daily_activity" DROP COLUMN "resources_touched";

-- ============================================================================
-- Tables, leaves first so every DROP is a plain DROP: an edge or join table
-- always goes before the tables it references.
-- ============================================================================

DROP TABLE "friction_events";
DROP TABLE "goal_targets";
DROP TABLE "resource_links";
DROP TABLE "weekly_allocations";
DROP TABLE "track_skills";
DROP TABLE "lesson_skills";
DROP TABLE "skill_edges";
DROP TABLE "notes";
DROP TABLE "tasks";
DROP TABLE "goals";
DROP TABLE "weekly_plans";
DROP TABLE "weekly_reviews";
DROP TABLE "notification_prefs";
DROP TABLE "notifications";
DROP TABLE "resources";
DROP TABLE "skills";
