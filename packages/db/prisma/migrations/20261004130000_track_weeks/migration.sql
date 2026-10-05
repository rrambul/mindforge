-- A module keeps the week it was first given — FR-B4, PLAN-WEEKS.md, TECH-DESIGN §3.2d.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why `prisma migrate
-- dev` cannot run here).
--
-- The first draft of the calendar derived a module's week on every read from its
-- place among the modules the plan still had. A revision that dropped or inserted
-- a module then moved every later week by seven days, with nothing on screen to
-- say so — and a calendar that moves is not the fixed calendar the learner planned
-- around. So the week is pinned here, by the reindexer, the first time the module
-- is indexed (`pinWeeks` in packages/core), and never reassigned. A dropped module
-- keeps its slot; a new module takes the next free week.
--
-- Index, like every column the reindexer writes: rebuilding a mission from its files
-- assigns weeks again in the plan's order.

ALTER TABLE "tracks" ADD COLUMN "week" SMALLINT;

ALTER TABLE "tracks" ADD CONSTRAINT "tracks_week_range"
  CHECK ("week" IS NULL OR "week" BETWEEN 1 AND 52);

-- One module per week of a mission, whatever the plan does later.
CREATE UNIQUE INDEX "tracks_one_per_week_key" ON "tracks"("mission_id", "week")
  WHERE "week" IS NOT NULL;

COMMENT ON COLUMN "tracks"."week" IS
  'The week this module was first given (FR-B4). Pinned by the reindexer, never reassigned. Null for a mission with no calendar.';

-- Missions already planned in weeks: their modules in the plan's order, as the
-- first draft derived them, so nothing on screen moves on the day this ships.
UPDATE "tracks" t SET "week" = ranked.week
  FROM (
    SELECT tr.id, row_number() OVER (PARTITION BY tr.mission_id ORDER BY tr.position, tr.slug) AS week
      FROM "tracks" tr JOIN "missions" m ON m.id = tr.mission_id
     WHERE m.weeks IS NOT NULL AND tr.status <> 'dropped'
  ) ranked
 WHERE t.id = ranked.id AND ranked.week <= 52;
