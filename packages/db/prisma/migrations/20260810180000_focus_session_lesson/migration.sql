-- A focus session can say which lesson the time bought — FR-F3, NORTHSTAR.md M5.
--
-- Hand-written, like every migration after the initial one: `prisma migrate dev`
-- cannot introspect past the `profiles.id → auth.users.id` cross-schema foreign
-- key, so the SQL is the source and `schema.prisma` is kept in step by hand.
--
-- The column arrives *with* the reader that writes it. `focus_sessions.mission_id`
-- shipped in M2 ahead of anything that set it and spent a milestone reading null;
-- `missions.workspace_key` did the same in M3. Until M5 there was no screen that
-- knew which lesson you were on, so there was nothing true to put here.

ALTER TABLE "focus_sessions" ADD COLUMN "lesson_id" UUID;

COMMENT ON COLUMN "focus_sessions"."lesson_id" IS
  'The lesson this block was spent on (FR-F3). Optional, and never asked twice: it is set by starting the timer from the reader, not by a picker.';

-- SET NULL, like `mission_id`, and for the same reason: the session is the
-- expensive artifact and the binding is the cheap one. A deleted lesson must not
-- take an hour of recorded attention with it — the minutes were still spent, and
-- the frequency tracker has to keep counting the day.
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A lesson belongs to a mission, so a session bound to one is bound to that
-- mission too. Enforced here rather than left to the writer, because the failure is
-- silent: a session with a lesson and no mission disappears from every per-mission
-- total while still being counted in the global one, and the two figures disagree
-- with nobody able to say why.
--
-- That the lesson belongs to *that* mission is checked by the use case. Expressing
-- it here would need a composite foreign key over `(mission_id, lesson_id)`, whose
-- SET NULL would then race the one above on the same rows.
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_lesson_implies_mission"
  CHECK ("lesson_id" IS NULL OR "mission_id" IS NOT NULL);

-- "How long did this lesson take" is the question M6's time views ask of it, and
-- it is asked per user because every read in this product is.
CREATE INDEX "focus_sessions_user_id_lesson_id_idx"
  ON "focus_sessions"("user_id", "lesson_id");

-- No new policy: `focus_sessions` already has one, and RLS is per row rather than
-- per column. What this column *can* leak is a lesson id that is not yours, which
-- RLS cannot catch — the row is still your own. `BindFocusSessionToLesson` in the
-- API checks ownership before writing, and apps/api/test/capture-loop.test.ts
-- proves it with two real users.
