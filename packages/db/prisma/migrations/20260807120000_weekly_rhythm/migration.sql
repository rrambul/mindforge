-- The weekly rhythm (M2) — TECH-DESIGN.md §3.3, §3.5, §3.9.
--
-- Hand-written, like every migration after the initial one. `prisma migrate dev`
-- cannot run in this repo: the `profiles.id → auth.users.id` foreign key added in
-- 20260805155000 is a cross-schema reference, and Prisma refuses to introspect it
-- unless `auth` is listed in the datasource's `schemas` — which would hand Prisma
-- ownership of tables Supabase owns. The trade is deliberate: migrations are
-- written by hand and proven by the RLS and integration suites rather than by a
-- diff.

-- ============================================================================
-- Two columns on existing tables.
-- ============================================================================

-- FR-F5 allocates weekly minutes per mission OR skill, and plan-vs-actual is the
-- entire point. Without this, a skill allocation has a planned number and no
-- actual to set beside it — the shape M1 already learned to distrust, where the
-- schema looks ready and the feature cannot be finished. `friction_events` has
-- carried skill_id since the start, so the asymmetry read as an oversight in
-- §3.3 rather than a rule.
ALTER TABLE "focus_sessions" ADD COLUMN "skill_id" UUID;

ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "focus_sessions_user_id_skill_id_started_at_idx"
  ON "focus_sessions"("user_id", "skill_id", "started_at");

COMMENT ON COLUMN "focus_sessions"."skill_id" IS
  'Optional session subject. Makes a skill''s weekly plan measurable (FR-F5); in M4 lessons make this derivable and it becomes the fallback.';

-- Nullable rather than defaulted to the current version: null means "never
-- opened", which is a different fact from "opened at 1.0.0" and is what decides
-- whether a brand-new account sees the unseen-entries dot (§14.1).
ALTER TABLE "profiles" ADD COLUMN "changelog_seen_version" TEXT;

-- ============================================================================
-- Weekly plans and their allocations (FR-F5).
-- ============================================================================

CREATE TABLE "weekly_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id")
);

-- A DATE, not a timestamp. A week boundary is a calendar fact derived from the
-- user's timezone and `profiles.week_starts_on` (Monday for en, Sunday for
-- pt-BR — FR-L5). Stored as an instant, the same week would land on different
-- days for a traveller, and every rollup would disagree with the grid.
COMMENT ON COLUMN "weekly_plans"."week_start" IS
  'First day of the week in the user''s timezone, honouring profiles.week_starts_on.';

CREATE UNIQUE INDEX "weekly_plans_user_id_week_start_key"
  ON "weekly_plans"("user_id", "week_start");

ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "weekly_allocations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "mission_id" UUID,
    "skill_id" UUID,
    "planned_minutes" INTEGER NOT NULL,

    CONSTRAINT "weekly_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "weekly_allocations_user_id_plan_id_idx"
  ON "weekly_allocations"("user_id", "plan_id");

ALTER TABLE "weekly_allocations" ADD CONSTRAINT "weekly_allocations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_allocations" ADD CONSTRAINT "weekly_allocations_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_allocations" ADD CONSTRAINT "weekly_allocations_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_allocations" ADD CONSTRAINT "weekly_allocations_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §3.3 specifies `primary key (plan_id, mission_id, skill_id)` here, which
-- Postgres rejects outright: a primary key column cannot be null, and both
-- subject columns are. The row carries its own id instead, and the two
-- invariants the composite key was reaching for are stated directly.
--
-- One subject per row. An allocation against both a mission and a skill would
-- be counted twice by plan-vs-actual, and against neither is a planned number
-- with nothing to plan for.
ALTER TABLE "weekly_allocations" ADD CONSTRAINT "weekly_allocations_one_subject"
  CHECK (num_nonnulls("mission_id", "skill_id") = 1);

-- At most one allocation per subject per week. Two rows for the same mission
-- would silently sum, so an edit that failed to find the existing row would
-- read as a doubled target rather than as a bug.
CREATE UNIQUE INDEX "weekly_allocations_plan_mission_key"
  ON "weekly_allocations"("plan_id", "mission_id") WHERE "skill_id" IS NULL;
CREATE UNIQUE INDEX "weekly_allocations_plan_skill_key"
  ON "weekly_allocations"("plan_id", "skill_id") WHERE "mission_id" IS NULL;

-- Zero is not an allocation, it is the absence of one, and a grid full of
-- zeroes makes plan-vs-actual list things you never intended to do. The UI
-- deletes the row when you clear the field.
ALTER TABLE "weekly_allocations" ADD CONSTRAINT "weekly_allocations_minutes_positive"
  CHECK ("planned_minutes" > 0);

-- ============================================================================
-- The weekly review ritual (FR-F6).
-- ============================================================================

CREATE TABLE "weekly_reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_one_thing" TEXT,
    "note" TEXT,

    CONSTRAINT "weekly_reviews_pkey" PRIMARY KEY ("id")
);

-- Keyed on the week rather than on a plan: reviewing a week you never planned
-- is legitimate and common, and the actuals are there either way.
CREATE UNIQUE INDEX "weekly_reviews_user_id_week_start_key"
  ON "weekly_reviews"("user_id", "week_start");

ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- M2's finish line is "three weekly reviews and changed one thing because of
-- one" (NORTHSTAR.md §4). A column is the only way that is observable rather
-- than remembered.
COMMENT ON COLUMN "weekly_reviews"."changed_one_thing" IS
  'The one thing this review changed. NORTHSTAR M2 finish line.';

-- ============================================================================
-- The nightly rollup (§3.5, §3.9).
-- ============================================================================

CREATE TABLE "daily_activity" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "focus_minutes" INTEGER NOT NULL DEFAULT 0,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "ember_minutes" INTEGER NOT NULL DEFAULT 0,
    "slag_minutes" INTEGER NOT NULL DEFAULT 0,
    "notes_captured" INTEGER NOT NULL DEFAULT 0,
    "resources_touched" INTEGER NOT NULL DEFAULT 0,
    "rebuilt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_activity_pkey" PRIMARY KEY ("user_id","day")
);

ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Four of §3.5's columns are deliberately absent — reviews_done,
-- reviews_correct, lessons_completed and artifacts_logged have no source table
-- until M4–M6, so they could only ever read zero, and a zero is a claim that
-- something was measured. They arrive with the tables that can fill them.
COMMENT ON TABLE "daily_activity" IS
  'Nightly rollup per user timezone. Every dashboard reads this, never raw sessions (§3.9).';

-- These do not sum to focus_minutes. A session with no friction contributes to
-- focus and to neither of these, which is the honest answer rather than calling
-- unexamined time ember.
COMMENT ON COLUMN "daily_activity"."ember_minutes" IS
  'Intensity-weighted minutes of productive friction. ember + slag covers only sessions that hit friction.';

COMMENT ON COLUMN "daily_activity"."resources_touched" IS
  'Distinct resources held a focus session on. Resources keep a progress snapshot, not a log, so nothing dated exists to count otherwise.';

-- A stale grid and an empty grid look identical without this, and a nightly job
-- is the thing most likely to fail quietly.
COMMENT ON COLUMN "daily_activity"."rebuilt_at" IS
  'When the rollup last wrote this row.';

-- ============================================================================
-- Notifications (FR-N1, FR-N3, FR-N4).
-- ============================================================================

CREATE TABLE "notification_prefs" (
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("user_id","kind")
);

ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_kind_known"
  CHECK ("kind" IN ('weekly_review','stall'));

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "subject_type" TEXT,
    "subject_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_known"
  CHECK ("kind" IN ('weekly_review','stall'));

-- The nightly job runs every night and would otherwise re-raise the same stall
-- each time. Uniqueness here is what makes the job safe to re-run, which is the
-- only way a scheduled job can be written.
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key"
  ON "notifications"("user_id", "dedupe_key");

CREATE INDEX "notifications_user_id_dismissed_at_created_at_idx"
  ON "notifications"("user_id", "dismissed_at", "created_at");

-- ICU arguments, never text. The message key is `kind` and the SPA translates at
-- render, like every other string in the product (§5.2) — a notification with
-- English baked into the row is one that cannot be read in pt-BR.
COMMENT ON COLUMN "notifications"."payload" IS
  'ICU arguments for the message keyed by `kind`. Never rendered text.';

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
    'weekly_plans', 'weekly_allocations', 'weekly_reviews',
    'daily_activity', 'notification_prefs', 'notifications'
  ] LOOP
    EXECUTE format('alter table %I enable row level security', t);
    EXECUTE format(
      'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  END LOOP;
END $$;
