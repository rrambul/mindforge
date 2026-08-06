-- A `skill_band` target measures ordinal distance from the band the skill was in when the target was
-- set (TECH-DESIGN.md §3.8). That starting point cannot be recovered afterwards — once the skill has
-- moved, nothing in the database remembers where it began — so it is captured at creation.
--
-- Nullable because it only applies to one kind, and null for the rest is the honest encoding rather
-- than a default band that would look like a real observation.
alter table goal_targets
  add column band_at_start text
  check (band_at_start is null or band_at_start in ('aware','assisted','working','fluent','teaching'));

comment on column goal_targets.band_at_start is
  'skill_band only: the band at target creation, which is where §3.8 measures distance from.';
