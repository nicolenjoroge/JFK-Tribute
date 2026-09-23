-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- Safe to run multiple times.

create extension if not exists "pgcrypto";

-- The single profile row: name, dates, tagline, portrait, story
create table if not exists profile (
  id text primary key default 'main',
  name text,
  dates text,
  tagline text,
  portrait_url text,
  story text,
  updated_at timestamptz default now()
);

insert into profile (id) values ('main')
on conflict (id) do nothing;

-- Photo gallery
create table if not exists gallery (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  caption text,
  created_at timestamptz default now()
);

-- Public tribute / condolence messages
create table if not exists tributes (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Anonymous',
  message text not null,
  created_at timestamptz default now()
);

-- Row Level Security: enabled, with NO public policies defined.
-- The backend server talks to Supabase using the service_role key, which
-- bypasses RLS entirely. This means the tables cannot be read or written
-- directly from the browser -- all access goes through your Express API.
alter table profile enable row level security;
alter table gallery enable row level security;
alter table tributes enable row level security;

-- ---------------------------------------------------------------------
-- Storage: bucket for uploaded photos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tribute-photos', 'tribute-photos', true)
on conflict (id) do nothing;

-- Public read of files in this bucket
drop policy if exists "Public read tribute photos" on storage.objects;

create policy "Public read tribute photos"
on storage.objects for select
using ( bucket_id = 'tribute-photos' );

-- Authenticated users can upload. Admin restriction happens server-side
-- (ADMIN_EMAILS), so this just requires *some* logged-in session.
drop policy if exists "Authenticated upload tribute photos" on storage.objects;

create policy "Authenticated upload tribute photos"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'tribute-photos' );

-- Authenticated users can delete.
drop policy if exists "Authenticated delete tribute photos" on storage.objects;

create policy "Authenticated delete tribute photos"
on storage.objects for delete
to authenticated
using ( bucket_id = 'tribute-photos' );
