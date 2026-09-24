-- What a lesson changed about the plan, and why — FR-D2–D4, PLAN-HANDS-ON.md Phase 3.
--
-- Hand-written (see 20260810180000_focus_session_lesson for why).
--
-- All three come from the lesson file's own <meta> tags, like `track_id` and the
-- plan claim, so they are index: rewritten by every reindex, never edited here.
-- The file says what it is; this makes it queryable. Adaptation that is not
-- visible is hidden decay by another name (non-negotiable 10), so the curriculum
-- screen reads these to say which lessons were bridges and which were pushed.

ALTER TABLE "lessons" ADD COLUMN "adjustment" TEXT;
ALTER TABLE "lessons" ADD COLUMN "adjustment_reason" TEXT;
ALTER TABLE "lessons" ADD COLUMN "bridge_for_slug" TEXT;

-- `bridge` — a smaller step toward a lesson that landed too hard.
-- `harder` — pitched a step above the plan after lessons that landed too easy.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_adjustment_known"
  CHECK ("adjustment" IS NULL OR "adjustment" IN ('bridge', 'harder'));

-- A reason is shown on screen; it has no business being an essay, and it has no
-- meaning without an adjustment to explain.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_adjustment_reason_shape"
  CHECK ("adjustment_reason" IS NULL
         OR ("adjustment" IS NOT NULL AND length("adjustment_reason") BETWEEN 1 AND 500));

-- A slug, not a foreign key: the lesson it names is claimed by slug the same way a
-- plan entry is, and a regenerated target keeps its slug while its row may not.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_bridge_for_needs_bridge"
  CHECK ("bridge_for_slug" IS NULL OR "adjustment" = 'bridge');

COMMENT ON COLUMN "lessons"."adjustment" IS
  'bridge | harder, from <meta name="mindforge:adjusted">. Index: rebuilt from the file.';
