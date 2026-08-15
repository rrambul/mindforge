-- The index behind round-robin dispatch — `prisma-dispatch.gateway.ts`.
--
-- Hand-written, like every migration after the initial one: `prisma migrate dev`
-- cannot introspect past the `profiles.id → auth.users.id` cross-schema foreign
-- key. Index-only, so there is no RLS policy to add and no table to test isolation
-- on; `agent_runs` already has both.
--
-- **Why this exists.** The dispatcher used to take the oldest queued run across
-- every user, which is fair between runs and unfair between people: the worker
-- runs one agent at a time, a run takes about eight minutes, and the
-- single-active-run constraint is per *mission*. One learner pressing the button
-- on six missions therefore owned the worker for three quarters of an hour while
-- everyone else waited, with nothing on any screen to explain the delay.
--
-- The ordering is now "whoever was served longest ago goes next", which needs the
-- most recent `started_at` per user. That is a correlated `max()` evaluated once
-- per runnable row, on a query the dispatcher runs every five seconds forever —
-- exactly the shape that is invisible on a laptop and a sequential scan per tick
-- in a year.
--
-- Partial, because the aggregate only ever looks at rows that have started. A run
-- that is still queued has no `started_at` and contributes nothing, and excluding
-- those keeps the index roughly the size of the answered questions rather than of
-- the table.

CREATE INDEX "agent_runs_user_id_started_at_idx"
  ON "agent_runs" ("user_id", "started_at" DESC)
  WHERE "started_at" IS NOT NULL;

COMMENT ON INDEX "agent_runs_user_id_started_at_idx" IS
  'Round-robin dispatch: the most recent start per learner, so the worker serves whoever has waited longest.';
