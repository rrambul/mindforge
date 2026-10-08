-- The mission's banner — FR-T10.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why `prisma migrate
-- dev` cannot run here).
--
-- An index entry like any other, written by the reindexer from the workspace
-- (files are canonical): set when a sync or `put:workspace` carries
-- `assets/banner.svg`, cleared when one deletes it. Not read from
-- `workspace_files`, which only a real run's sync writes — a banner landed from a
-- terminal would otherwise exist in Storage and nowhere the page could see it.
--
-- `missions` already has its RLS policy; a column inherits it.

ALTER TABLE "missions" ADD COLUMN "banner_path" TEXT;

-- One path, so the page can never be pointed at another file of the workspace
-- through this column — a lesson, say, rendered as an `<img>` outside its frame.
ALTER TABLE "missions" ADD CONSTRAINT "missions_banner_path"
  CHECK ("banner_path" IS NULL OR "banner_path" = 'assets/banner.svg');

-- Banners a real run already synced.
UPDATE "missions" m SET "banner_path" = 'assets/banner.svg'
  WHERE EXISTS (SELECT 1 FROM "workspace_files" f
                 WHERE f."mission_id" = m."id" AND f."path" = 'assets/banner.svg');

COMMENT ON COLUMN "missions"."banner_path" IS
  'Workspace-relative path of the mission''s banner, or null. Set by the reindexer (FR-T10).';
