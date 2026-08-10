-- Tracks: the subtopic level, and the module of lessons under it —
-- TECH-DESIGN.md §3.2, §7.2, §7.4; NORTHSTAR.md M4.
--
-- Hand-written, like every migration after the initial one, for the reason
-- 20260808120000 gives at length: `prisma migrate dev` cannot introspect past the
-- `profiles.id → auth.users.id` cross-schema foreign key.
--
-- A mission is a main topic. Under it sit **tracks** — subtopics — ordered
-- fundamentals first, and a track's lessons are its module. `CURRICULUM.md` is
-- canonical for all of it (non-negotiable 5); everything here rebuilds by
-- re-reading a workspace.
--
-- M7 calls this level an "arm" and calls the table `tracks`. It arrives four
-- milestones early because a module of lessons is a track's lessons, and one
-- entity is enough for both. What M7 still owes is `domains` and the galaxy that
-- renders them — the argument for putting M7 after M6 was that brightness must be
-- evidence-backed, which is a claim about the picture and not about the taxonomy.

-- ============================================================================
-- tracks — a subtopic of a mission.
-- ============================================================================

CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outcome" TEXT,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- The slug is the stable identifier and the name is not. A lesson names its track
-- in a `<meta name="mindforge:track">` tag, and `CURRICULUM.md` is rewritten
-- wholesale on every revision — so renaming a track must be free and changing its
-- slug must orphan a module loudly rather than quietly.
COMMENT ON COLUMN "tracks"."slug" IS
  'Stable identifier, named by each lesson''s <meta name="mindforge:track">. Renaming the track is free; changing this orphans its lessons.';

-- The recommended reading order, fundamentals first. **A plan, not the truth.**
-- What to teach next is §9.4''s ZPD score over `skill_edges` and real evidence;
-- this column is what the curriculum proposed. Where the two disagree that is a
-- signal for M8, not a bug to fix by trusting the column — a linear order treated
-- as authoritative replaces an evidence-driven system with a hand-authored one.
COMMENT ON COLUMN "tracks"."position" IS
  'Recommended reading order from CURRICULUM.md. A plan, not a prerequisite — sequencing comes from track_edges and evidence.';

-- `dropped` rather than deleted, because the agent rewrites `CURRICULUM.md`
-- wholesale: a track missing from one regeneration would otherwise take a module
-- of finished lessons with it. Same shape as the RESOURCES.md upsert-key problem.
COMMENT ON COLUMN "tracks"."status" IS
  'proposed | active | done | dropped. A track absent from a regenerated CURRICULUM.md is marked dropped, never deleted.';

ALTER TABLE "tracks" ADD CONSTRAINT "tracks_status_known"
  CHECK ("status" IN ('proposed', 'active', 'done', 'dropped'));

-- Unique per mission, never globally: two missions may both have a `fundamentals`
-- track, and a global unique would let the first account to claim one take it
-- from everyone — the mistake `missions.workspace_key` shipped with and
-- 20260808120000 corrected.
CREATE UNIQUE INDEX "tracks_mission_id_slug_key" ON "tracks"("mission_id", "slug");

CREATE INDEX "tracks_user_id_mission_id_position_idx"
  ON "tracks"("user_id", "mission_id", "position");

-- One active track per mission. The same mechanism as
-- `agent_runs_one_active_per_mission_key`, for a related reason: eight half-open
-- modules is the backlog the weekly review already measures, and lessons are
-- generated one at a time into whichever track is open.
CREATE UNIQUE INDEX "tracks_one_active_per_mission_key"
  ON "tracks"("mission_id") WHERE "status" = 'active';

ALTER TABLE "tracks" ADD CONSTRAINT "tracks_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tracks" ADD CONSTRAINT "tracks_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- track_edges — prerequisites between tracks.
--
-- Same shape and same limitation as `skill_edges`: a DAG cannot be expressed as a
-- constraint, so cycle prevention lives in the application layer and this table
-- can only refuse the self-edge.
-- ============================================================================

CREATE TABLE "track_edges" (
    "user_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "prereq_id" UUID NOT NULL,

    CONSTRAINT "track_edges_pkey" PRIMARY KEY ("track_id", "prereq_id")
);

ALTER TABLE "track_edges" ADD CONSTRAINT "track_edges_not_self"
  CHECK ("track_id" <> "prereq_id");

ALTER TABLE "track_edges" ADD CONSTRAINT "track_edges_track_id_fkey"
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "track_edges" ADD CONSTRAINT "track_edges_prereq_id_fkey"
  FOREIGN KEY ("prereq_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- track_skills — what a track intends to build.
--
-- Written by `curriculum` before any lesson for the track exists, which is the
-- whole point of generating lessons lazily: the intent is knowable up front and
-- the material is not.
-- ============================================================================

CREATE TABLE "track_skills" (
    "user_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,

    CONSTRAINT "track_skills_pkey" PRIMARY KEY ("track_id", "skill_id")
);

ALTER TABLE "track_skills" ADD CONSTRAINT "track_skills_track_id_fkey"
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "track_skills" ADD CONSTRAINT "track_skills_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "track_skills_user_id_skill_id_idx" ON "track_skills"("user_id", "skill_id");

-- ============================================================================
-- lesson_skills — what a lesson actually taught.
--
-- `lessons.outcome` has carried a comment naming it "the first automatic skill
-- evidence, in M4" since the M0 schema, and nothing has ever joined a lesson to a
-- skill: FR-T9's evidence had no target. This is that join, and it is a table
-- rather than a column because a lesson teaches more than one thing.
--
-- The distinction from `track_skills` is intent versus fact. A track says what it
-- means to build; a lesson says what it built. They disagree, and the gap is
-- worth being able to see.
-- ============================================================================

CREATE TABLE "lesson_skills" (
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,

    CONSTRAINT "lesson_skills_pkey" PRIMARY KEY ("lesson_id", "skill_id")
);

ALTER TABLE "lesson_skills" ADD CONSTRAINT "lesson_skills_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lesson_skills" ADD CONSTRAINT "lesson_skills_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "lesson_skills_user_id_skill_id_idx" ON "lesson_skills"("user_id", "skill_id");

-- ============================================================================
-- lessons.track_id and agent_runs.track_id.
-- ============================================================================

ALTER TABLE "lessons" ADD COLUMN "track_id" UUID;

-- Nullable and it stays that way. Lessons written before the mission had a
-- curriculum have no track, a lesson taught deliberately off-plan has no track,
-- and neither is a defect — `<meta name="mindforge:track">` absent means the
-- lesson belongs to the mission and to no module.
COMMENT ON COLUMN "lessons"."track_id" IS
  'From the lesson''s own <meta name="mindforge:track">, never from CURRICULUM.md. Null is legal: pre-curriculum and off-plan lessons.';

-- SET NULL rather than CASCADE. A track is never deleted by the reindexer, but if
-- one is ever removed by hand the lessons it held are the expensive artifact and
-- the grouping is the cheap one. Losing a lesson is unacceptable (non-negotiable 6).
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_track_id_fkey"
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "lessons_track_id_seq_idx" ON "lessons"("track_id", "seq");

ALTER TABLE "agent_runs" ADD COLUMN "track_id" UUID;

-- Which module this run is filling in. Null for runs that are not track-scoped:
-- a `generate_curriculum` run precedes every track, and the weekly digest belongs
-- to no mission at all.
COMMENT ON COLUMN "agent_runs"."track_id" IS
  'The track a generate_lesson run is teaching within. Null for curriculum runs and for anything not scoped to one module.';

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_track_id_fkey"
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Row-level security.
--
-- Same shape as every other table: you may touch a row if and only if it is
-- yours (§3.6). The `has RLS enabled with a policy on every public table` test in
-- test/rls.test.ts fails the day one of these is forgotten.
--
-- The three join tables carry their own `user_id` rather than reaching through a
-- foreign key. It denormalises, and it is what makes the policy a column
-- comparison instead of a subquery — non-negotiable 1 says every repository
-- method takes `userId`, and the worker bypasses RLS on the service-role key, so
-- these columns are also what a service-role write has to get right.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tracks', 'track_edges', 'track_skills', 'lesson_skills'
  ] LOOP
    EXECUTE format('alter table %I enable row level security', t);
    EXECUTE format(
      'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  END LOOP;
END $$;
