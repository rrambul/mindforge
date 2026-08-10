-- The planned-lesson model — TECH-DESIGN.md §3.2b, NORTHSTAR.md M4, FR-K2/K6/K7.
--
-- `CURRICULUM.md` now plans each module's lessons before any of them is written,
-- and this is where those plans live. Hand-written, like every migration after the
-- initial one: `prisma migrate dev` cannot introspect past the
-- `profiles.id → auth.users.id` cross-schema foreign key.
--
-- The columns arrive *with* the parser and the UI that write and read them, which
-- is why 20260810120000 deliberately left them out. Nothing here is speculative.
--
-- **One row, two lives.** A planned lesson is a row with no file; generation
-- attaches the file to that same row and flips its status. It is not two rows
-- joined, because two rows means an orphan the day a slug is reworded — and the
-- denominator of every module fraction would then quietly gain a lesson the
-- learner has already finished.

-- ============================================================================
-- lessons — the plan columns, and a file that may not be there yet.
-- ============================================================================

ALTER TABLE "lessons" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'generated';
ALTER TABLE "lessons" ADD COLUMN "intent" TEXT;
ALTER TABLE "lessons" ADD COLUMN "difficulty" SMALLINT;
ALTER TABLE "lessons" ADD COLUMN "depth" TEXT;
ALTER TABLE "lessons" ADD COLUMN "position" SMALLINT;

-- Defaulting to `generated` rather than `planned` is what makes this migration
-- true about the rows already here: every existing lesson has a file. A default of
-- `planned` would relabel real lessons as intentions.
COMMENT ON COLUMN "lessons"."status" IS
  'planned | generated. A planned lesson is a row with no file; generation fills the same row in.';

COMMENT ON COLUMN "lessons"."intent" IS
  'One line from CURRICULUM.md: what this lesson is for. Null for lessons taught off-plan.';

-- Difficulty is a claim about the lesson relative to this learner's current
-- level, never a score for the learner (non-negotiable 10, and the `curriculum`
-- skill says the same thing to the agent). Null means the plan did not say — the
-- UI renders that as unknown, never as a middling 3.
COMMENT ON COLUMN "lessons"."difficulty" IS
  '1-5, how hard for THIS learner. Null when the plan left it blank; never defaulted.';

COMMENT ON COLUMN "lessons"."depth" IS
  'overview | working | deep_dive. How far down the lesson goes, not how long it takes.';

-- The plan's own row order within its module. A plan, exactly like
-- `tracks.position`: what unblocks next comes from `lesson_edges` and difficulty
-- (FR-K7), and this is only the tie-break and the display order.
COMMENT ON COLUMN "lessons"."position" IS
  'Row order within its module in CURRICULUM.md. A plan, not a prerequisite — sequencing comes from lesson_edges.';

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_status_known"
  CHECK ("status" IN ('planned', 'generated'));

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_difficulty_range"
  CHECK ("difficulty" IS NULL OR "difficulty" BETWEEN 1 AND 5);

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_depth_known"
  CHECK ("depth" IS NULL OR "depth" IN ('overview', 'working', 'deep_dive'));

-- A planned lesson has no file, so the three columns that describe one become
-- nullable. They were NOT NULL and they stay effectively NOT NULL for anything
-- generated, enforced by `lessons_generated_has_file` below.
ALTER TABLE "lessons" ALTER COLUMN "seq" DROP NOT NULL;
ALTER TABLE "lessons" ALTER COLUMN "storage_path" DROP NOT NULL;
ALTER TABLE "lessons" ALTER COLUMN "content_hash" DROP NOT NULL;

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_generated_has_file"
  CHECK ("status" <> 'generated'
         OR ("seq" IS NOT NULL AND "storage_path" IS NOT NULL AND "content_hash" IS NOT NULL));

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_planned_has_no_file"
  CHECK ("status" <> 'planned'
         OR ("seq" IS NULL AND "storage_path" IS NULL AND "content_hash" IS NULL));

-- A lesson nobody can open cannot have been understood. Without this, a plan
-- revision that re-planned a finished lesson could carry its outcome forward onto
-- a row with no content — a completion claim about a file that does not exist.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_planned_not_completed"
  CHECK ("status" <> 'planned' OR ("completed_at" IS NULL AND "outcome" IS NULL));

-- **Partial, and that is the whole design.** The plan owns each slug exactly once
-- per mission, which is how a generated lesson finds the row it is claiming. The
-- moment it claims it the row leaves this index, so two written lessons may share
-- a filename slug — `0003-recap.html` and `0011-recap.html` are both legal, and a
-- total unique here would fail the reindex of a workspace that has them.
-- Generated rows keep their own identity, `(mission_id, seq)`, unchanged.
CREATE UNIQUE INDEX "lessons_planned_slug_key"
  ON "lessons"("mission_id", "slug") WHERE "status" = 'planned';

-- The curriculum screen reads a module in plan order; `lessons_track_id_seq_idx`
-- cannot serve it, because a planned lesson has no seq.
CREATE INDEX "lessons_track_id_position_idx" ON "lessons"("track_id", "position");

-- ============================================================================
-- lesson_edges — "A depends on B", read two ways.
--
-- Forwards it locks: A is unblocked when every B it depends on is completed
-- (FR-K7). Backwards it is what makes B fundamental: the more lessons depend on
-- it, the more fundamental it is (FR-K6). One edge, both readings, neither of them
-- ever stored — both are computed on read in `packages/core`.
--
-- Same shape and same limitation as `track_edges`: a DAG is not expressible as a
-- constraint, so cycle-breaking lives in the parser and this table can refuse only
-- the self-edge.
-- ============================================================================

CREATE TABLE "lesson_edges" (
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "prereq_id" UUID NOT NULL,

    CONSTRAINT "lesson_edges_pkey" PRIMARY KEY ("lesson_id", "prereq_id")
);

ALTER TABLE "lesson_edges" ADD CONSTRAINT "lesson_edges_not_self"
  CHECK ("lesson_id" <> "prereq_id");

-- CASCADE on both sides, unlike `lessons.track_id`. An edge is not an artifact:
-- it describes a relationship between two lessons, and when either end is gone the
-- statement is no longer about anything. Nothing is lost that the file cannot say
-- again.
ALTER TABLE "lesson_edges" ADD CONSTRAINT "lesson_edges_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lesson_edges" ADD CONSTRAINT "lesson_edges_prereq_id_fkey"
  FOREIGN KEY ("prereq_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The backwards reading is a query in its own right: "how many lessons depend on
-- this one" is what the fundamental badge counts, and the primary key indexes only
-- the forwards direction.
CREATE INDEX "lesson_edges_user_id_prereq_id_idx" ON "lesson_edges"("user_id", "prereq_id");

-- ============================================================================
-- Row-level security.
--
-- A join table carrying a denormalised `user_id` is the shape most likely to ship
-- without a policy — it looks like plumbing rather than like data. The
-- `has RLS enabled with a policy on every public table` test in test/rls.test.ts
-- fails the day one is forgotten, and test/curriculum-tracks.test.ts proves the
-- isolation with real rows.
-- ============================================================================

ALTER TABLE "lesson_edges" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_edges_owner" ON "lesson_edges"
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
