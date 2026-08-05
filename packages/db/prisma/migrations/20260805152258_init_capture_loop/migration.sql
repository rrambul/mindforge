-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "content_language" TEXT NOT NULL DEFAULT 'en',
    "week_starts_on" INTEGER NOT NULL DEFAULT 1,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "why" TEXT,
    "success_looks_like" TEXT,
    "constraints" TEXT,
    "current_level" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "workspace_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_revisions" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "mission_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_id" UUID,
    "title" TEXT NOT NULL,
    "definition_of_done" TEXT,
    "target_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "outcome_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_targets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "resource_id" UUID,
    "skill_id" UUID,
    "mission_id" UUID,
    "target" JSONB NOT NULL,
    "weight" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "met_at" TIMESTAMPTZ(6),

    CONSTRAINT "goal_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "band" TEXT NOT NULL DEFAULT 'aware',
    "perceived_level" DECIMAL(5,2),
    "score" DECIMAL(5,2),
    "score_std_dev" DECIMAL(5,2),
    "half_life_days" DECIMAL(6,2) NOT NULL DEFAULT 90,
    "last_evidence_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_edges" (
    "user_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "prereq_id" UUID NOT NULL,

    CONSTRAINT "skill_edges_pkey" PRIMARY KEY ("skill_id","prereq_id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "abandon_reason" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "trust" TEXT,
    "rejected_reason" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "mission_id" UUID,
    "skill_id" UUID,

    CONSTRAINT "resource_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID,
    "body" TEXT NOT NULL,
    "quote" TEXT,
    "locator" JSONB,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "lang" TEXT NOT NULL DEFAULT 'english',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "mission_id" UUID,
    "goal_id" UUID,
    "resource_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "estimate_minutes" INTEGER,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focus_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID,
    "mission_id" UUID,
    "resource_id" UUID,
    "intention" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "planned_minutes" INTEGER,
    "hit_intention" TEXT,
    "focus_quality" INTEGER,
    "energy" INTEGER,
    "note" TEXT,
    "entry_mode" TEXT NOT NULL DEFAULT 'timer',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friction_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "task_id" UUID,
    "skill_id" UUID,
    "resource_id" UUID,
    "type" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL DEFAULT 3,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friction_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "missions_workspace_key_key" ON "missions"("workspace_key");

-- CreateIndex
CREATE INDEX "missions_user_id_status_idx" ON "missions"("user_id", "status");

-- CreateIndex
CREATE INDEX "mission_revisions_mission_id_changed_at_idx" ON "mission_revisions"("mission_id", "changed_at");

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "goal_targets_user_id_goal_id_idx" ON "goal_targets"("user_id", "goal_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_user_id_slug_key" ON "skills"("user_id", "slug");

-- CreateIndex
CREATE INDEX "resources_user_id_status_idx" ON "resources"("user_id", "status");

-- CreateIndex
CREATE INDEX "resource_links_user_id_resource_id_idx" ON "resource_links"("user_id", "resource_id");

-- CreateIndex
CREATE INDEX "notes_user_id_subject_type_subject_id_created_at_idx" ON "notes"("user_id", "subject_type", "subject_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_started_at_idx" ON "focus_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_mission_id_started_at_idx" ON "focus_sessions"("user_id", "mission_id", "started_at");

-- CreateIndex
CREATE INDEX "friction_events_user_id_occurred_at_idx" ON "friction_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "friction_events_user_id_type_occurred_at_idx" ON "friction_events"("user_id", "type", "occurred_at");

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_revisions" ADD CONSTRAINT "mission_revisions_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_targets" ADD CONSTRAINT "goal_targets_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_targets" ADD CONSTRAINT "goal_targets_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_targets" ADD CONSTRAINT "goal_targets_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_edges" ADD CONSTRAINT "skill_edges_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_edges" ADD CONSTRAINT "skill_edges_prereq_id_fkey" FOREIGN KEY ("prereq_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friction_events" ADD CONSTRAINT "friction_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friction_events" ADD CONSTRAINT "friction_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friction_events" ADD CONSTRAINT "friction_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friction_events" ADD CONSTRAINT "friction_events_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friction_events" ADD CONSTRAINT "friction_events_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Row-level security.
--
-- Hand-written because Prisma cannot express policies. This lives in the
-- migration, never in the Supabase dashboard — clicking policies into the UI
-- is how environments drift. TECH-DESIGN.md §3.6.
--
-- Every user-owned table gets the same shape: you may touch a row if and only
-- if it is yours. `auth.uid()` resolves from request.jwt.claims, which the
-- Prisma client extension sets transaction-locally per request.
-- ============================================================================

-- profiles keys on id rather than user_id: the row IS the user.
alter table "profiles" enable row level security;
create policy "profiles_owner" on "profiles"
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'missions', 'mission_revisions', 'goals', 'goal_targets',
    'skills', 'skill_edges', 'resources', 'resource_links',
    'notes', 'tasks', 'focus_sessions', 'friction_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end $$;

-- ============================================================================
-- Full-text search over notes.
--
-- Stemming follows the CONTENT's language, not the UI locale: a note written
-- in Portuguese needs the Portuguese stemmer regardless of what the interface
-- is showing (FR-L4). The CASE keeps the expression immutable, which a
-- generated column requires.
-- ============================================================================

alter table "notes" add column "search" tsvector
  generated always as (
    to_tsvector(
      case "lang" when 'portuguese' then 'portuguese'::regconfig
                  else 'english'::regconfig end,
      coalesce("quote", '') || ' ' || "body"
    )
  ) stored;

create index "notes_search_idx" on "notes" using gin ("search");

-- ============================================================================
-- Profile provisioning.
--
-- Prisma cannot own auth.users, so a signup trigger creates the shadow row.
-- Without this, a brand-new account has nowhere to store its timezone and
-- every "today" query silently falls back to UTC.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
