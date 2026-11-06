-- Saved views: each person keeps their own named Task Register views ("Pune overdue", ...), and they
-- follow them to any PC. Only the owner of a view can see or change it.
-- Apply after 0016. Safe to re-run.

begin;

create table if not exists public.saved_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (btrim(name) <> '' and length(name) <= 60),
  filters    jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and length(filters::text) <= 2000),
  created_at timestamptz not null default now()
);
create unique index if not exists saved_views_user_name_key on public.saved_views (user_id, lower(btrim(name)));

alter table public.saved_views enable row level security;
drop policy if exists saved_views_own on public.saved_views;
create policy saved_views_own on public.saved_views for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;
