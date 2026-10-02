-- Exams and deadlines — FR-E1–E8, FR-U1–U6, PLAN-EXAMS.md, TECH-DESIGN §3.2d.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why `prisma migrate
-- dev` cannot run here).
--
-- Two halves with different owners, like exercises and their attempts:
--
-- * **What an exam is** comes from a lesson file that declares
--   `<meta name="mindforge:kind" content="exam">`, so it is index: `lessons.kind`,
--   rewritten by every reindex. An exam is a lesson row on purpose — it gets the
--   reader, the view grant, `lessons.exercises` and `exercise_attempts` without a
--   second copy of any of them.
-- * **When the learner said they would finish** has no file. `module_deadlines` is
--   the only copy, append-only, like `exercise_attempts`.

-- ============================================================================
-- lessons.kind
-- ============================================================================

ALTER TABLE "lessons" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'lesson';

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_kind_known"
  CHECK ("kind" IN ('lesson', 'exam'));

-- An exam is always a written file. A *planned* exam would be a plan entry, and the
-- plan is `CURRICULUM.md`'s — which does not plan exams. Being `generated` also keeps
-- it out of the partial `(mission_id, slug) WHERE status = 'planned'` index, so an
-- exam cannot claim a plan entry even by accident.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_exam_shape"
  CHECK ("kind" <> 'exam' OR "status" = 'generated');

COMMENT ON COLUMN "lessons"."kind" IS
  'lesson | exam, from <meta name="mindforge:kind"> (FR-E1). Index: rebuilt from the file. Exams are left out of every lesson derivation (FR-E2).';

-- "This module's exam" is the newest exam row filed under the track.
CREATE INDEX "lessons_track_id_kind_seq_idx" ON "lessons"("track_id", "kind", "seq");

-- ============================================================================
-- module_deadlines
-- ============================================================================

CREATE TABLE "module_deadlines" (
  "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID           NOT NULL,
  "track_id"   UUID           NOT NULL,
  -- A calendar day in the learner's timezone (FR-U6). A `date`, not an instant:
  -- "due on the 14th" stored as midnight UTC is a deadline on the 13th in São Paulo.
  "due_on"     DATE           NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "module_deadlines_pkey" PRIMARY KEY ("id"),
  -- A belt against a date typed into the wrong century. The API checks "today or
  -- later" in the learner's zone; the database can only check that it is plausible.
  CONSTRAINT "module_deadlines_due_on_plausible"
    CHECK ("due_on" BETWEEN DATE '2020-01-01' AND DATE '2100-12-31')
);

-- Cascade both ways: a deadline means nothing without its module, and a deleted
-- account takes everything (FR-A4). A track is never deleted by the reindexer —
-- a vanished one is marked dropped — so this cascade is account deletion in practice.
ALTER TABLE "module_deadlines" ADD CONSTRAINT "module_deadlines_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "module_deadlines" ADD CONSTRAINT "module_deadlines_track_id_fkey"
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every read is "this user's deadlines for these modules, in order".
CREATE INDEX "module_deadlines_user_id_track_id_created_at_idx"
  ON "module_deadlines"("user_id", "track_id", "created_at");

COMMENT ON TABLE "module_deadlines" IS
  'Append-only commitments (FR-U2). The newest row per track is in force; the first is what was originally committed; the rest are moves.';

-- ============================================================================
-- Row-level security.
--
-- Owner-only, like every table, and the insert checks the **track** as well as
-- `user_id` for the reason `exercise_attempts` checks its lesson: `user_id =
-- auth.uid()` proves the row is yours, not that the module it names is.
--
-- No UPDATE policy: a deadline is moved by adding a row, so the history of moves
-- cannot be rewritten into a promise kept. DELETE is the owner's, for account-level
-- cleanup, as on attempts.
-- ============================================================================

ALTER TABLE "module_deadlines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "module_deadlines_owner_select" ON "module_deadlines"
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "module_deadlines_owner_insert" ON "module_deadlines"
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM tracks t WHERE t.id = track_id AND t.user_id = auth.uid())
  );

CREATE POLICY "module_deadlines_owner_delete" ON "module_deadlines"
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================================
-- agent_runs.kind
-- ============================================================================

ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "agent_runs_kind_known";

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_kind_known"
  CHECK ("kind" IN ('generate_lesson', 'generate_curriculum', 'generate_exam', 'sync_workspace'));

COMMENT ON COLUMN "agent_runs"."kind" IS
  'generate_lesson | generate_curriculum | generate_exam | sync_workspace. Chosen by the API from the curriculum''s state (FR-K1, FR-E3), never by the client.';
