-- Bootstrap for Prisma's shadow database.
--
-- `prisma migrate dev` diffs against a temporary, bare Postgres instance that
-- has none of Supabase's managed schemas. Our migration references auth.users
-- and auth.uid(), so without these stubs the diff fails with
-- "schema auth does not exist" — even though the real database is fine.
--
-- These are stubs for diffing only. They are never applied to a real database:
-- Supabase owns the genuine auth schema there.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid
$$;
