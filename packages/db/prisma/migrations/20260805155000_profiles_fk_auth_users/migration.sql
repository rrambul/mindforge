-- Tie profiles to auth.users for real.
--
-- Prisma cannot model auth.users (Supabase owns that schema), so the generated
-- schema declares profiles.id as a bare uuid primary key with no reference.
-- The consequence is silent and serious: deleting an account removes the
-- auth.users row but leaves the profile — and therefore every mission,
-- session, note, and friction event — orphaned in the database. They stay
-- readable by anything that can present that user_id, and account deletion
-- (FR-A4) is quietly incomplete.
--
-- The application-level cascade from Profile does the rest: once the profile
-- goes, everything owned by it goes with it.

-- Clean up any rows already orphaned before the constraint is added, or the
-- ALTER will fail on existing data.
delete from profiles p
where not exists (select 1 from auth.users u where u.id = p.id);

alter table profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;
