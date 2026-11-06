-- Trackers and departments become managed lists (admin page "Lists").
-- - trackers: every tracker (manager's issue list) by name. Issues and manager profiles must point to a
--   tracker on the list, so a typo cannot create a phantom tracker. An admin can rename a tracker (all
--   its issues and its manager follow) or merge it into another one, and hide old ones from pickers.
-- - departments: the department codes offered in the app, with an optional full name. An admin can
--   merge a spelling into the right code (e.g. ENGG into PE) for every issue at once, and hide codes.
--   Existing data is not changed by this migration; the Lists page suggests the merges.
-- Apply after 0020. Safe to re-run.

begin;

-- ───────────── trackers ─────────────
create table if not exists public.trackers (
  name       text primary key check (btrim(name) <> '' and length(name) <= 80),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.trackers (name)
select distinct btrim(m) from (
  select manager as m from public.tasks
  union select manager_name from public.profiles where manager_name is not null
) s
where m is not null and btrim(m) <> ''
on conflict do nothing;

alter table public.trackers enable row level security;
drop policy if exists trackers_select on public.trackers;
create policy trackers_select on public.trackers for select to authenticated using (true);
drop policy if exists trackers_admin on public.trackers;
create policy trackers_admin on public.trackers for all to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

-- An admin (or SQL / server scripts) filing an issue under a new tracker name creates the tracker.
-- Managers and owners must pick an existing tracker; anything else is refused by the foreign key.
create or replace function public.tasks_ensure_tracker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager is not null and btrim(new.manager) <> '' and (auth.uid() is null or public.app_role() = 'admin') then
    insert into public.trackers (name) values (new.manager) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists a_tasks_ensure_tracker_trg on public.tasks;
create trigger a_tasks_ensure_tracker_trg before insert or update of manager on public.tasks
  for each row execute function public.tasks_ensure_tracker();

-- Giving someone a manager_name (admin, in SQL or the dashboard) creates that tracker.
create or replace function public.profiles_ensure_tracker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager_name is not null and btrim(new.manager_name) <> '' then
    insert into public.trackers (name) values (new.manager_name) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists a_profiles_ensure_tracker_trg on public.profiles;
create trigger a_profiles_ensure_tracker_trg before insert or update of manager_name on public.profiles
  for each row execute function public.profiles_ensure_tracker();

do $$ begin
  alter table public.tasks add constraint tasks_manager_fkey
    foreign key (manager) references public.trackers (name) on update cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_manager_name_fkey
    foreign key (manager_name) references public.trackers (name) on update cascade on delete set null;
exception when duplicate_object then null; end $$;

-- Trackers offered when filing an issue: the active ones.
create or replace function public.list_trackers()
returns setof text language sql stable security definer set search_path = public as $$
  select name from public.trackers where auth.uid() is not null and active order by 1
$$;

-- Rename a tracker, or merge it into an existing one. Issues, their History and the manager's
-- profile follow. Admin only. Returns the number of issues moved.
create or replace function public.rename_tracker(p_from text, p_to text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_to text := btrim(p_to); v_n integer := 0;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only an admin can rename or merge trackers.';
  end if;
  if v_to is null or v_to = '' then raise exception using errcode = '22023', message = 'Enter the new tracker name.'; end if;
  if not exists (select 1 from public.trackers where name = p_from) then
    raise exception using errcode = '22023', message = format('There is no tracker called "%s".', p_from);
  end if;
  if v_to = p_from then return 0; end if;
  if exists (select 1 from public.trackers where name = v_to) then
    update public.tasks set manager = v_to where manager = p_from;
    get diagnostics v_n = row_count;
    update public.profiles set manager_name = v_to where manager_name = p_from;
    delete from public.trackers where name = p_from;
  else
    select count(*) into v_n from public.tasks where manager = p_from;
    update public.trackers set name = v_to where name = p_from;   -- issues and profiles follow (on update cascade)
  end if;
  return v_n;
end $$;
revoke all on function public.rename_tracker(text, text) from public, anon;
grant execute on function public.rename_tracker(text, text) to authenticated;

-- ───────────── departments ─────────────
create table if not exists public.departments (
  code       text primary key check (btrim(code) <> '' and length(code) <= 40),
  name       text check (name is null or length(name) <= 80),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.departments (code)
select unnest(array['PRGM', 'PE', 'PRCE', 'PBYR', 'QE', 'LOG', 'KAM', 'CE'])
on conflict do nothing;
insert into public.departments (code)
select distinct btrim(dept) from public.tasks where dept is not null and btrim(dept) <> '' and dept <> 'Unassigned'
on conflict do nothing;

alter table public.departments enable row level security;
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated using (true);
drop policy if exists departments_admin on public.departments;
create policy departments_admin on public.departments for all to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

-- A department used on an issue (form, import, SQL) is added to the list, so nothing is ever lost.
create or replace function public.tasks_ensure_department() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dept is not null and btrim(new.dept) <> '' and new.dept <> 'Unassigned' then
    insert into public.departments (code) values (btrim(new.dept)) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists tasks_ensure_department_trg on public.tasks;
create trigger tasks_ensure_department_trg after insert or update of dept on public.tasks
  for each row execute function public.tasks_ensure_department();

-- Merge one department code into another (e.g. ENGG into PE) on every issue. Admin only.
create or replace function public.merge_department(p_from text, p_to text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_to text := btrim(p_to); v_n integer;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only an admin can merge departments.';
  end if;
  if v_to is null or v_to = '' or v_to = p_from then raise exception using errcode = '22023', message = 'Pick a different department to merge into.'; end if;
  insert into public.departments (code) values (v_to) on conflict do nothing;
  update public.tasks set dept = v_to where dept = p_from;
  get diagnostics v_n = row_count;
  delete from public.departments where code = p_from;
  return v_n;
end $$;
revoke all on function public.merge_department(text, text) from public, anon;
grant execute on function public.merge_department(text, text) to authenticated;

-- Issue counts per tracker and department for the Lists page (admins see every issue anyway).
create or replace function public.list_usage()
returns table (kind text, name text, issues bigint, open_issues bigint)
language sql stable security invoker set search_path = public as $$
  select 'tracker', manager, count(*), count(*) filter (where closed_date is null) from public.tasks group by manager
  union all
  select 'department', dept, count(*), count(*) filter (where closed_date is null) from public.tasks group by dept
$$;
grant execute on function public.list_usage() to authenticated;

commit;
