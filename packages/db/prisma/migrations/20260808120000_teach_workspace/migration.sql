-- The teach workspace and the agent (M3) — TECH-DESIGN.md §3.2, §3.5, §7.2-§7.6.
--
-- Hand-written, like every migration after the initial one. `prisma migrate dev`
-- cannot run in this repo: the `profiles.id → auth.users.id` foreign key added in
-- 20260805155000 is a cross-schema reference, and Prisma refuses to introspect it
-- unless `auth` is listed in the datasource's `schemas` — which would hand Prisma
-- ownership of tables Supabase owns. The trade is deliberate: migrations are
-- written by hand and proven by the RLS and integration suites rather than by a
-- diff.
--
-- Everything below is an index over files. Storage is canonical (non-negotiable 5),
-- and every one of these tables can be rebuilt by re-reading a workspace. That is
-- what makes a defensive parser the right answer to a format change: a row that
-- cannot be reconstructed is a row we should not have been trusting.

-- ============================================================================
-- missions.workspace_key — the Storage prefix, now scoped to its owner.
-- ============================================================================

-- `workspace_key` shipped in the M0 schema with a comment saying it is set once
-- so renaming a mission cannot move files, and nothing has ever written it. M3 is
-- the milestone that does — which is also when its uniqueness turns out to be
-- wrong.
--
-- The Storage path is `workspaces/<user_id>/<workspace_key>/`, so the key only
-- has to be unique *within* a user. Globally unique means the first account to
-- take `rust` takes it from everyone, and the 409 that follows tells the second
-- user that somebody else has a mission by that name. A uniqueness constraint
-- that leaks the existence of another account's row is a privacy bug wearing a
-- constraint's clothes.
DROP INDEX "missions_workspace_key_key";

CREATE UNIQUE INDEX "missions_user_id_workspace_key_key"
  ON "missions"("user_id", "workspace_key");

COMMENT ON COLUMN "missions"."workspace_key" IS
  'Storage prefix under workspaces/<user_id>/. Set once at first materialisation: renaming a mission must not move files.';

-- ============================================================================
-- Lessons, reference docs and learning records (FR-T4, FR-T5, FR-T6).
--
-- Indexes over ./lessons/*.html, ./reference/*.html and ./learning-records/*.md.
-- ============================================================================

CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- From the filename (`0007-closures.html`), never from the document. An `<h1>` is
-- the agent's prose and changes when it rewrites the lesson; the number is the
-- workspace's own ordering and is what a learning record links back to.
COMMENT ON COLUMN "lessons"."seq" IS
  'Sequence from the filename, not from the document. A mismatch with the H1 is a parser warning, not an error.';

-- Nullable, and it stays null for the whole of M3. The in-app reader that would
-- set it is M4, and a default of anything else would be a claim that a lesson was
-- read (non-negotiable 10).
COMMENT ON COLUMN "lessons"."completed_at" IS
  'Set by the sandboxed reader in M4. Null means unread OR not-yet-trackable — the UI must not render either as a zero.';

CREATE UNIQUE INDEX "lessons_mission_id_seq_key" ON "lessons"("mission_id", "seq");

CREATE INDEX "lessons_user_id_mission_id_idx" ON "lessons"("user_id", "mission_id");

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_outcome_known"
  CHECK ("outcome" IS NULL OR "outcome" IN ('understood', 'shaky', 'lost'));

CREATE TABLE "reference_docs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reference_docs_pkey" PRIMARY KEY ("id")
);

-- Reference docs have no NNNN — the skill names them by slug, because unlike
-- lessons they are revised in place rather than superseded. So the natural key is
-- the path, and it is what stops a second reindex from doubling the library.
CREATE UNIQUE INDEX "reference_docs_mission_id_storage_path_key"
  ON "reference_docs"("mission_id", "storage_path");

CREATE INDEX "reference_docs_user_id_mission_id_idx"
  ON "reference_docs"("user_id", "mission_id");

ALTER TABLE "reference_docs" ADD CONSTRAINT "reference_docs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reference_docs" ADD CONSTRAINT "reference_docs_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "learning_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "lesson_id" UUID,
    "what_learned" TEXT NOT NULL,
    "evidence" TEXT,
    "key_insight" TEXT,
    "struggles" TEXT,
    "next" TEXT,
    "storage_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "supersedes_id" UUID,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_records_pkey" PRIMARY KEY ("id")
);

-- The `## Next` section is the ZPD recommender's only real input in M3 (FR-T7).
-- Skill-graph gaps need evidence and due reviews need M5, so a briefing that
-- called this "your ZPD" would be overstating what it read.
COMMENT ON COLUMN "learning_records"."next" IS
  'What this unlocks. The sole ZPD input until skill evidence (M4/M6) and review scheduling (M5) exist.';

-- `Date: YYYY-MM-DD` in the record resolves in the *user's* timezone. Stored as an
-- instant so it sorts with everything else, but a record dated 2026-08-08 that
-- lands on 2026-08-07 moves which weekly review it belongs to.
COMMENT ON COLUMN "learning_records"."recorded_at" IS
  'From the record''s Date: line, resolved in the user''s IANA timezone — never server-local.';

CREATE UNIQUE INDEX "learning_records_mission_id_seq_key"
  ON "learning_records"("mission_id", "seq");

CREATE INDEX "learning_records_user_id_mission_id_recorded_at_idx"
  ON "learning_records"("user_id", "mission_id", "recorded_at");

ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Set null rather than cascade: the record outlives the lesson it came from. The
-- format calls records append-only, and deleting the source of an insight must not
-- delete the insight.
ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "learning_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- The sync ledger (§7.4).
-- ============================================================================

CREATE TABLE "workspace_files" (
    "user_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_etag" TEXT,
    "storage_version" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_files_pkey" PRIMARY KEY ("mission_id", "path")
);

-- Probed against storage-api v1.60.4, because the conflict design rests on it:
-- the ETag is md5(content) for a single-part upload, and Supabase Storage ignores
-- `If-Match` on write — a PUT with a deliberately wrong one returns 200 and
-- overwrites. So this detects a concurrent writer and cannot exclude one.
COMMENT ON COLUMN "workspace_files"."storage_etag" IS
  'md5(content) from list()/info(). Detects a concurrent write; there is no conditional write to prevent one.';

-- The better change token, and the reason it is stored alongside rather than
-- instead: `version` moves on every write including a byte-identical rewrite,
-- where the ETag (being content-derived) does not.
COMMENT ON COLUMN "workspace_files"."storage_version" IS
  'Storage object version UUID. Changes on every write, including one that leaves the bytes identical.';

CREATE INDEX "workspace_files_user_id_mission_id_idx"
  ON "workspace_files"("user_id", "mission_id");

ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Agent runs (FR-T3) and what they cost (non-negotiable 9).
-- ============================================================================

CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "job_id" TEXT,
    "input" JSONB,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- `succeeded_with_conflicts` is a success: the run did its work and both versions
-- of every contested file were kept (§7.4). Folding it into `failed` would make
-- the honest outcome look like the broken one and push people toward resolving
-- conflicts by re-running.
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_known"
  CHECK ("status" IN ('queued', 'running', 'succeeded', 'succeeded_with_conflicts', 'failed', 'cancelled'));

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_kind_known"
  CHECK ("kind" IN ('generate_lesson', 'sync_workspace', 'generate_assessment',
                    'grade_teach_back', 'weekly_digest', 'generate_plan'));

-- **One run per mission at a time.** §7.3 used to say "enforced with a BullMQ job
-- key"; there is no Redis and no queue. This is the enforcement — insert, and let
-- 23505 become a 409. Two concurrent runs against one workspace is the fastest
-- route to a corrupt sync.
--
-- Partial, so finished runs accumulate freely; the same shape as
-- weekly_allocations' two indexes. Invisible to schema.prisma, like every partial
-- index in this repo.
CREATE UNIQUE INDEX "agent_runs_one_active_per_mission_key"
  ON "agent_runs"("mission_id")
  WHERE "status" IN ('queued', 'running');

-- What a queue would have given for free and this does not: a lease. The run
-- writes this on every message it receives, and a reaper fails runs whose
-- heartbeat has gone stale. Without it a worker that dies mid-run holds the index
-- entry forever and that mission can never be taught again.
COMMENT ON COLUMN "agent_runs"."heartbeat_at" IS
  'Liveness lease. A running row with a stale heartbeat is reaped to failed, or its mission is wedged forever.';

-- A BullMQ artifact kept for the day there is a queue. Unused while the scheduler
-- is an in-process setTimeout.
COMMENT ON COLUMN "agent_runs"."job_id" IS
  'External job id. Unused while the scheduler is in-process; see TECH-DESIGN.md §10.';

CREATE INDEX "agent_runs_user_id_created_at_idx" ON "agent_runs"("user_id", "created_at");

CREATE INDEX "agent_runs_status_heartbeat_at_idx" ON "agent_runs"("status", "heartbeat_at");

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "llm_calls" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_run_id" UUID,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "call_key" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6),
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- §3.5 specified `user_id uuid` nullable, for calls made by nothing on nobody's
-- behalf. There are none: every model call in this product is triggered by a
-- person. Nullable would also mean a cost row that RLS renders invisible to
-- everyone — a bill nobody can audit, and one that FR-A4's export would silently
-- omit. NOT NULL is the narrower and more honest column.
COMMENT ON COLUMN "llm_calls"."user_id" IS
  'Never null. A cost row nobody owns is a cost row nobody can audit, and RLS would hide it from everyone.';

-- Nullable because a price can be genuinely unknown — the Agent SDK reports
-- whatever model id it used, and an id absent from packages/llm's table has no
-- price. Unknown is not zero (non-negotiable 10), so it is recorded as null with a
-- warning rather than defaulted to 0.
COMMENT ON COLUMN "llm_calls"."cost_usd" IS
  'Null when the model is not in the pricing table. Never 0 as a stand-in — zero is a measurement.';

-- The idempotency key for the agent path: `request_id` from the assistant message
-- where present, `message.id` otherwise. Both were populated in the M3 probe, but
-- `request_id` is optional on the SDK type, hence the fallback and the nullable
-- column.
COMMENT ON COLUMN "llm_calls"."call_key" IS
  'Per-run dedupe key. Parallel tool calls emit several assistant messages sharing one id and one usage figure.';

-- Purpose vocabulary is open on purpose — every future call site adds one, and a
-- CHECK here would make `llm_calls` a table you migrate to add a feature. Two are
-- reserved by §8.6: `teach_turn` for a visible assistant message, and
-- `teach_overhead` for the reconciliation row that makes a run's calls sum to its
-- modelUsage. Without the second, the SDK's own internal model calls — 22% of the
-- probe run's cost — are billed to nobody.
COMMENT ON COLUMN "llm_calls"."purpose" IS
  'Call site. teach_turn = a visible assistant message; teach_overhead = the modelUsage residual (§8.6).';

CREATE UNIQUE INDEX "llm_calls_agent_run_id_call_key_key"
  ON "llm_calls"("agent_run_id", "call_key")
  WHERE "agent_run_id" IS NOT NULL AND "call_key" IS NOT NULL;

CREATE INDEX "llm_calls_user_id_created_at_idx" ON "llm_calls"("user_id", "created_at");

CREATE INDEX "llm_calls_agent_run_id_idx" ON "llm_calls"("agent_run_id");

ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Set null, not cascade. Deleting a run must not delete what it cost — the cost
-- meter and the monthly cap are the two things that must survive a tidy-up.
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Per-user learner memory (§7.6).
-- ============================================================================

CREATE TABLE "learner_memories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "written_by" TEXT NOT NULL DEFAULT 'agent',
    "confirmed_at" TIMESTAMPTZ(6),
    "superseded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learner_memories_pkey" PRIMARY KEY ("id")
);

-- Replayed verbatim into every future run, on every mission. That is what makes a
-- wrong entry expensive and a reviewable one non-negotiable — §7.6: the agent
-- writes it, the user owns it.
COMMENT ON TABLE "learner_memories" IS
  'Index over memory/<user_id>/*.md. Replayed into every agent run, so the user can read, edit and delete every row.';

-- One line, and it is the part that gets loaded for relevance selection once the
-- memory outgrows what is worth injecting whole.
COMMENT ON COLUMN "learner_memories"."summary" IS
  'The file''s one-line header. What gets loaded for relevance selection when the memory grows.';

-- Supersede, never mutate. Seeing that a stated preference changed is the point;
-- quietly overwriting it is how a model accumulates conclusions about someone
-- that nobody agreed to.
COMMENT ON COLUMN "learner_memories"."superseded_by" IS
  'Corrections point forward to their replacement. The old row stays, because the change is itself information.';

ALTER TABLE "learner_memories" ADD CONSTRAINT "learner_memories_kind_known"
  CHECK ("kind" IN ('background', 'teaching_preference', 'learning_pattern', 'constraint'));

ALTER TABLE "learner_memories" ADD CONSTRAINT "learner_memories_written_by_known"
  CHECK ("written_by" IN ('agent', 'user'));

CREATE UNIQUE INDEX "learner_memories_user_id_slug_key" ON "learner_memories"("user_id", "slug");

ALTER TABLE "learner_memories" ADD CONSTRAINT "learner_memories_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learner_memories" ADD CONSTRAINT "learner_memories_superseded_by_fkey"
  FOREIGN KEY ("superseded_by") REFERENCES "learner_memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Row-level security.
--
-- Same shape as every other table: you may touch a row if and only if it is
-- yours (§3.6). The `has RLS enabled with a policy on every public table` test
-- in test/rls.test.ts fails the day one of these is forgotten.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lessons', 'reference_docs', 'learning_records', 'workspace_files',
    'agent_runs', 'llm_calls', 'learner_memories'
  ] LOOP
    EXECUTE format('alter table %I enable row level security', t);
    EXECUTE format(
      'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  END LOOP;
END $$;
