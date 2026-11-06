-- Brembo Program Command — database schema, security and audit trail.
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to read top to bottom.
-- Security model: EVERY rule below is enforced by Postgres (row level security + triggers),
-- so the browser can never see or change more than the signed-in role allows.

-- ───────────── profiles: one row per login, created automatically ─────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  name         text not null,
  role         text not null default 'owner' check (role in ('admin','manager','owner')),
  manager_name text,   -- role=manager: must equal tasks.manager (that manager's tracker)
  owner_name   text,   -- role=owner:   must equal tasks.owner   (their assigned actions)
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- New accounts start as 'owner' with NO owner_name => they see nothing until an admin
  -- assigns access (see supabase/provision-users.sql). Nobody can self-promote.
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers used by the policies (security definer => no RLS recursion)
create or replace function public.app_role()    returns text language sql stable security definer set search_path = public as $$ select role         from public.profiles where id = auth.uid() $$;
create or replace function public.app_manager() returns text language sql stable security definer set search_path = public as $$ select manager_name from public.profiles where id = auth.uid() $$;
create or replace function public.app_owner()   returns text language sql stable security definer set search_path = public as $$ select owner_name   from public.profiles where id = auth.uid() $$;
create or replace function public.app_name()    returns text language sql stable security definer set search_path = public as $$ select name         from public.profiles where id = auth.uid() $$;

alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');
-- no insert/update/delete policies: profiles are changed only by an admin via SQL / dashboard.

-- ───────────── tasks: RAW inputs only (status / RGY / escalation are derived daily in the app) ─────────────
create table if not exists public.tasks (
  id          text primary key,             -- e.g. SI-17
  manager     text not null,                -- whose tracker this row belongs to
  program     text not null,
  description text not null,
  dept        text not null default 'Unassigned',
  owner       text not null default 'Unassigned',
  member      text,
  start_date  date,
  due_date    date,                         -- Target Date
  next_date   date,                         -- Next Date
  closed_date date,                         -- Actual Close Date
  remark      text,
  custom      jsonb not null default '{}'::jsonb,   -- room for new fields without a migration
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);
create index if not exists tasks_manager_idx  on public.tasks (manager);
create index if not exists tasks_owner_idx    on public.tasks (owner);
create index if not exists tasks_open_due_idx on public.tasks (due_date) where closed_date is null;

alter table public.tasks enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (
     public.app_role() = 'admin'
  or (public.app_role() = 'manager' and manager = public.app_manager())
  or (public.app_role() = 'owner'   and owner   = public.app_owner())
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
     public.app_role() = 'admin'
  or (public.app_role() = 'manager' and manager = public.app_manager())
  or (public.app_role() = 'owner'   and owner   = public.app_owner())
) with check (
     public.app_role() = 'admin'
  or (public.app_role() = 'manager' and manager = public.app_manager())
  or (public.app_role() = 'owner'   and owner   = public.app_owner())
);
-- No insert/delete policy: rows are created by the import (seed.sql / service role) only.

-- Column-level rules RLS cannot express
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return new; end if;      -- SQL editor / service role (imports, maintenance)
  r := public.app_role();
  if r is null then raise exception 'No profile for this user'; end if;
  if new.id is distinct from old.id then raise exception 'Issue id cannot change'; end if;
  if r <> 'admin' and new.manager is distinct from old.manager then
    raise exception 'Only an admin can move an issue to another tracker';
  end if;
  if r = 'owner' then
    if (new.program, new.description, new.dept, new.owner, new.member, new.start_date,
        new.due_date, new.next_date, new.remark, new.custom)
       is distinct from
       (old.program, old.description, old.dept, old.owner, old.member, old.start_date,
        old.due_date, old.next_date, old.remark, old.custom) then
      raise exception 'Owners can only attach proof and close their own actions';
    end if;
    if old.closed_date is not null and new.closed_date is distinct from old.closed_date then
      raise exception 'Only a manager can reopen or change a close date';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists tasks_guard_trg on public.tasks;
create trigger tasks_guard_trg before update on public.tasks
  for each row execute function public.tasks_guard();

-- ───────────── audit trail (written by triggers, so it cannot be skipped or forged) ─────────────
create table if not exists public.task_events (
  id         bigint generated always as identity primary key,
  task_id    text not null references public.tasks(id) on delete cascade,
  actor      uuid,
  actor_name text,
  action     text not null,                 -- update | proof_added | proof_removed
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events (task_id, at desc);
alter table public.task_events enable row level security;
drop policy if exists events_select on public.task_events;
create policy events_select on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));   -- inherits task visibility

create or replace function public.tasks_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old) - array['updated_at','updated_by'];
  n jsonb := to_jsonb(new) - array['updated_at','updated_by'];
  changes jsonb := '{}'::jsonb;
  k text;
begin
  for k in select jsonb_object_keys(n) loop
    if (o -> k) is distinct from (n -> k) then
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
    end if;
  end loop;
  if changes <> '{}'::jsonb then
    insert into public.task_events (task_id, actor, actor_name, action, detail)
    values (new.id, auth.uid(), public.app_name(), 'update', changes);
  end if;
  return new;
end $$;
drop trigger if exists tasks_log_trg on public.tasks;
create trigger tasks_log_trg after update on public.tasks
  for each row execute function public.tasks_log();

-- ───────────── proofs (metadata here, file bytes in the private 'proofs' storage bucket) ─────────────
create table if not exists public.proofs (
  id            uuid primary key default gen_random_uuid(),
  task_id       text not null references public.tasks(id) on delete cascade,
  path          text not null unique,        -- storage object key: <task_id>/<uuid>-<filename>
  filename      text not null,
  mime          text,
  size          bigint,
  uploaded_by   uuid references auth.users(id) default auth.uid(),
  uploaded_name text,
  created_at    timestamptz not null default now()
);
create index if not exists proofs_task_idx on public.proofs (task_id);
alter table public.proofs enable row level security;

drop policy if exists proofs_select on public.proofs;
create policy proofs_select on public.proofs for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists proofs_insert on public.proofs;
create policy proofs_insert on public.proofs for insert to authenticated
  with check (uploaded_by = auth.uid()
              and exists (select 1 from public.tasks t where t.id = task_id));

-- Owners cannot delete evidence; only managers/admins (for tasks they can see).
drop policy if exists proofs_delete on public.proofs;
create policy proofs_delete on public.proofs for delete to authenticated
  using (public.app_role() in ('admin','manager')
         and exists (select 1 from public.tasks t where t.id = task_id));

create or replace function public.proofs_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by   := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_name := coalesce(public.app_name(), new.uploaded_name);
  return new;
end $$;
drop trigger if exists proofs_stamp_trg on public.proofs;
create trigger proofs_stamp_trg before insert on public.proofs
  for each row execute function public.proofs_stamp();

create or replace function public.proofs_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor, actor_name, action, detail)
    values (new.task_id, auth.uid(), public.app_name(), 'proof_added',
            jsonb_build_object('filename', new.filename, 'size', new.size));
  else
    insert into public.task_events (task_id, actor, actor_name, action, detail)
    values (old.task_id, auth.uid(), public.app_name(), 'proof_removed',
            jsonb_build_object('filename', old.filename));
  end if;
  return null;
end $$;
drop trigger if exists proofs_log_trg on public.proofs;
create trigger proofs_log_trg after insert or delete on public.proofs
  for each row execute function public.proofs_log();

-- ───────────── private storage bucket for proof files ─────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('proofs', 'proofs', false, 10485760)          -- 10 MB per file, never public
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Object key starts with the task id, so access follows task visibility.
drop policy if exists proofs_obj_read on storage.objects;
create policy proofs_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs'
         and exists (select 1 from public.tasks t where t.id = (storage.foldername(name))[1]));

drop policy if exists proofs_obj_upload on storage.objects;
create policy proofs_obj_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs'
              and exists (select 1 from public.tasks t where t.id = (storage.foldername(name))[1])
              and lower(name) ~ '\.(pdf|png|jpe?g|webp|gif|txt|csv|docx?|xlsx?|pptx?|msg|eml)$');

drop policy if exists proofs_obj_delete on storage.objects;
create policy proofs_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'proofs'
         and public.app_role() in ('admin','manager')
         and exists (select 1 from public.tasks t where t.id = (storage.foldername(name))[1]));

-- ───────────── realtime: live updates to everyone viewing the same tracker (still filtered by RLS) ─────────────
do $$ begin alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.proofs;
exception when duplicate_object then null; when undefined_object then null; end $$;
