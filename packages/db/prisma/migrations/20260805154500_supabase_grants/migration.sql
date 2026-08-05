-- Restore Supabase role grants on the public schema.
--
-- `prisma migrate reset` runs DROP SCHEMA public CASCADE, which destroys the
-- grants Supabase provisions for its roles. Without these, `authenticated`
-- cannot even see the tables — queries fail with 42P01 "relation does not
-- exist" rather than a permission error, which is a confusing way to discover
-- the problem.
--
-- Deliberately NOT granting to `anon`: this product has no anonymous data
-- access by design (FR-A3), so the role that should never read anything is
-- not given the ability to try. That is tighter than Supabase's default and
-- correct here. RLS remains the actual row-level protection.

grant usage on schema public to authenticated, service_role;

grant all on all tables    in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant all on all functions in schema public to authenticated, service_role;

-- Future tables created by postgres inherit the same grants, so a new
-- migration cannot silently reintroduce the problem.
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;
alter default privileges in schema public
  grant all on functions to authenticated, service_role;
