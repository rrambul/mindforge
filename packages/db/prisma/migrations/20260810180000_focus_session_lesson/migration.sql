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

-- "How long did this lesson take" is the question M6's time views ask of it, and
-- it is asked per user because every read in this product is.
CREATE INDEX "focus_sessions_user_id_lesson_id_idx"
  ON "focus_sessions"("user_id", "lesson_id");

-- ============================================================================
-- Two invariants this migration deliberately does NOT enforce, and why.
--
-- Both are real, both hold, and both are the application's to keep —
-- `ResolveSessionSubject` reads the lesson and takes the mission from it, so a
-- bound session is complete and consistent by construction, and
-- apps/api/test/lessons.test.ts proves it over HTTP with two users.
--
-- **"A lesson binding implies a mission."** Written first as
-- `CHECK (lesson_id IS NULL OR mission_id IS NOT NULL)`, and it broke deleting a
-- mission. Dropping a mission fires two referential actions on this table —
-- `mission_id` to NULL from the mission's own foreign key, and `lesson_id` to
-- NULL as the mission's lessons cascade away — and a CHECK is evaluated per row
-- update, immediately, with no way to defer it (Postgres allows DEFERRABLE on
-- UNIQUE, PRIMARY KEY, EXCLUDE and FOREIGN KEY, never on CHECK). Whichever action
-- runs first, the row is momentarily half-cleared and the constraint fires. The
-- symptom was every mission delete failing with 23514, including the one behind
-- account deletion (FR-A4).
--
-- **"The lesson belongs to that mission."** The natural expression is a composite
-- foreign key over `(mission_id, lesson_id)`, and MATCH FULL would carry the first
-- invariant along with it. It cannot be used: MATCH FULL forbids mixing null and
-- non-null key values, and a session bound to a mission with no particular lesson
-- is the ordinary case — most sessions are exactly that. Probed against the real
-- table before being ruled out, not reasoned about.
-- ============================================================================

-- No new policy either: `focus_sessions` already has one, and RLS is per row
-- rather than per column. What this column *can* leak is a lesson id that is not
-- yours, which RLS cannot catch — the row being written is still your own.
