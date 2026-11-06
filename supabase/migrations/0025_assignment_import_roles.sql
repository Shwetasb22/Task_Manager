-- Align the existing tasks/profiles/employees schema with unrestricted assignment and BYBRE roles.
-- Apply after 0024. Safe to re-run.

begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'dept_head', 'manager', 'owner'));

update public.profiles
set role = 'admin', name = 'Naveen Sahni'
where lower(email) = 'naveen.sahni@bremboindia.com';

update public.profiles
set role = 'dept_head', name = 'Vishal Shinde'
where lower(email) = 'vishal.shinde@bremboindia.com'
   or lower(btrim(name)) = 'vishal shinde';

do $$
begin
  if to_regclass('public.trackers') is not null and exists (select 1 from public.trackers where name = 'Abhijit') then
    if exists (select 1 from public.trackers where name = 'Abhijit Mendki') then
      update public.tasks set manager = 'Abhijit Mendki' where manager = 'Abhijit';
      update public.profiles set manager_name = 'Abhijit Mendki' where manager_name = 'Abhijit';
      delete from public.trackers where name = 'Abhijit';
    else
      update public.trackers set name = 'Abhijit Mendki' where name = 'Abhijit';
    end if;
  else
    update public.tasks set manager = 'Abhijit Mendki' where manager = 'Abhijit';
    update public.profiles set manager_name = 'Abhijit Mendki' where manager_name = 'Abhijit';
  end if;
end $$;

create table if not exists public.assignment_history (
  id bigint generated always as identity primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  from_person text,
  to_person text not null,
  changed_by uuid references auth.users(id),
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists assignment_history_task_idx on public.assignment_history (task_id, changed_at desc);
create index if not exists tasks_manager_due_closed_idx on public.tasks (manager, due_date, closed_date);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'employees') then
      execute 'alter publication supabase_realtime add table public.employees';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'departments') then
      execute 'alter publication supabase_realtime add table public.departments';
    end if;
  end if;
end $$;

alter table public.assignment_history enable row level security;
drop policy if exists assignment_history_select on public.assignment_history;
create policy assignment_history_select on public.assignment_history
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_id)
  );

create or replace function public.tasks_record_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from old.owner then
    insert into public.assignment_history (task_id, from_person, to_person, changed_by, changed_by_name)
    values (new.id, old.owner, new.owner, auth.uid(), public.app_name());
  end if;
  return null;
end;
$$;
drop trigger if exists tasks_record_assignment_trg on public.tasks;
create trigger tasks_record_assignment_trg after update of owner on public.tasks
  for each row execute function public.tasks_record_assignment();

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (
     (select public.app_role()) in ('admin', 'dept_head')
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or ((select public.app_role()) = 'owner' and public.owner_tokens(owner) && (select public.app_owner_aliases()))
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
     (select public.app_role()) in ('admin', 'dept_head')
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or ((select public.app_role()) = 'owner' and public.owner_tokens(owner) && (select public.app_owner_aliases()))
) with check (
     (select public.app_role()) in ('admin', 'dept_head')
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or (select public.app_role()) = 'owner'
);

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check (
     (select public.app_role()) in ('admin', 'dept_head', 'owner')
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
);

create or replace function public.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  new.program := btrim(coalesce(new.program, ''));
  new.description := btrim(coalesce(new.description, ''));
  new.owner := coalesce(nullif(btrim(new.owner), ''), 'Unassigned');
  new.dept := coalesce(nullif(btrim(new.dept), ''), 'Unassigned');

  if new.manager is null or btrim(new.manager) = '' then
    raise exception using errcode = '23514', message = 'An issue must belong to a tracker.';
  end if;

  if auth.uid() is not null then
    r := public.app_role();
    if r is null or r not in ('admin', 'dept_head', 'manager', 'owner') then
      raise exception using errcode = '42501', message = 'Your account cannot add issues.';
    end if;
    if new.program = '' then
      raise exception using errcode = '23514', message = 'Program is required.';
    end if;
    if new.description = '' then
      raise exception using errcode = '23514', message = 'Issue description is required.';
    end if;
    if new.start_date is not null and new.due_date is not null and new.due_date < new.start_date then
      raise exception using errcode = '23514', message = 'Target date cannot be before the start date.';
    end if;
    if new.id is null or btrim(new.id) = '' then
      new.id := public.next_task_id(new.manager);
    end if;
    new.updated_by := auth.uid();
  elsif new.id is null or btrim(new.id) = '' then
    new.id := public.next_task_id(new.manager);
  end if;

  return new;
end;
$$;

create or replace function public.guard_manager_task_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_allowed text[] := array['program', 'description', 'dept', 'customer', 'owner', 'member', 'start_date',
                            'due_date', 'next_date', 'closed_date', 'remark', 'custom', 'updated_at', 'updated_by'];
begin
  if auth.uid() is null then return new; end if;
  v_role := public.app_role();
  if v_role = 'admin' then return new; end if;
  if v_role = 'owner' and old.closed_date is not null and new.closed_date is distinct from old.closed_date then
    raise exception using errcode = '42501',
      message = 'Only your manager can reopen a closed issue or change its close date.';
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception using errcode = '42501', message = 'The issue ID and tracker cannot be changed here.';
  end if;
  return new;
end;
$$;

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated
  with check ((select public.app_role()) in ('admin', 'dept_head', 'manager'));
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using ((select public.app_role()) in ('admin', 'dept_head', 'manager'))
  with check ((select public.app_role()) in ('admin', 'dept_head', 'manager'));
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete to authenticated
  using ((select public.app_role()) = 'admin');

create or replace function public.employees_guard_name()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.name is distinct from old.name and public.app_role() is distinct from 'dept_head' then
    raise exception using errcode = '42501', message = 'Only a dept head can edit an owner name.';
  end if;
  return new;
end;
$$;
drop trigger if exists employees_guard_name_trg on public.employees;
create trigger employees_guard_name_trg before update of name on public.employees
  for each row execute function public.employees_guard_name();

drop policy if exists departments_admin on public.departments;
create policy departments_admin on public.departments for all to authenticated
  using ((select public.app_role()) in ('admin', 'dept_head', 'manager'))
  with check ((select public.app_role()) in ('admin', 'dept_head', 'manager'));

create or replace function public.rename_owner(p_from text, p_to text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_count integer;
begin
  if (select public.app_role()) is distinct from 'dept_head' then
    raise exception using errcode = '42501', message = 'Only a dept head can rename owners.';
  end if;
  if public.norm_name(p_from) is null or public.norm_name(p_to) is null then
    raise exception using errcode = '22023', message = 'Enter both names.';
  end if;
  update public.tasks
  set owner = public.replace_owner_name(owner, p_from, p_to)
  where public.owner_tokens(owner) @> array[public.norm_name(p_from)]
    and public.replace_owner_name(owner, p_from, p_to) is distinct from owner;
  get diagnostics v_count = row_count;
  update public.employees set name = btrim(p_to) where public.norm_name(name) = public.norm_name(p_from);
  return v_count;
end;
$$;

create or replace function public.import_tasks(p_manager text, p_adds jsonb, p_updates jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  a jsonb;
  u jsonb;
  p jsonb;
  v_label text;
  v_n integer;
  v_added integer := 0;
  v_updated integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to import.';
  end if;
  p_adds := coalesce(p_adds, '[]'::jsonb);
  p_updates := coalesce(p_updates, '[]'::jsonb);
  if jsonb_typeof(p_adds) <> 'array' or jsonb_typeof(p_updates) <> 'array' then
    raise exception using errcode = '22023', message = 'The import is not in the expected format.';
  end if;
  if jsonb_array_length(p_adds) + jsonb_array_length(p_updates) > 500 then
    raise exception using errcode = '22023', message = 'Import requests are limited to 500 rows.';
  end if;

  for u in select value from jsonb_array_elements(p_updates) loop
    v_label := 'Excel row ' || coalesce(u ->> 'row', '?') || ' (' || coalesce(u ->> 'id', '?') || ')';
    p := coalesce(u -> 'patch', '{}'::jsonb);
    begin
      update public.tasks t set
        program = case when p ? 'program' then p ->> 'program' else t.program end,
        description = case when p ? 'desc' then p ->> 'desc' else t.description end,
        dept = case when p ? 'dept' then p ->> 'dept' else t.dept end,
        customer = case when p ? 'customer' then p ->> 'customer' else t.customer end,
        owner = case when p ? 'owner' then p ->> 'owner' else t.owner end,
        member = case when p ? 'member' then p ->> 'member' else t.member end,
        start_date = case when p ? 'start' then nullif(p ->> 'start', '')::date else t.start_date end,
        due_date = case when p ? 'due' then nullif(p ->> 'due', '')::date else t.due_date end,
        next_date = case when p ? 'next' then nullif(p ->> 'next', '')::date else t.next_date end,
        closed_date = case when p ? 'closed' then nullif(p ->> 'closed', '')::date else t.closed_date end,
        remark = case when p ? 'remark' then nullif(p ->> 'remark', '') else t.remark end,
        custom = case when p ? 'source_status'
          then coalesce(t.custom, '{}'::jsonb) || jsonb_build_object('status', p ->> 'source_status')
          else t.custom end
      where t.id = u ->> 'id'
        and (not (u ? 'seen') or t.updated_at = (u ->> 'seen')::timestamptz);
      get diagnostics v_n = row_count;
    exception when others then
      raise exception using errcode = sqlstate, message = v_label || ': ' || sqlerrm;
    end;
    if v_n = 0 then
      raise exception using errcode = '42501', message = v_label || ': the issue was not saved or changed since the preview.';
    end if;
    v_updated := v_updated + 1;
  end loop;

  for a in select value from jsonb_array_elements(p_adds) loop
    v_label := 'Excel row ' || coalesce(a ->> 'row', '?');
    begin
      insert into public.tasks (id, manager, program, description, dept, customer, owner, member,
                                start_date, due_date, next_date, closed_date, remark, custom)
      values (
        nullif(a ->> 'id', ''), p_manager, a ->> 'program', a ->> 'desc', coalesce(nullif(a ->> 'dept', ''), 'Unassigned'),
        coalesce(a ->> 'customer', ''), coalesce(nullif(a ->> 'owner', ''), 'Unassigned'),
        coalesce(nullif(a ->> 'member', ''), nullif(a ->> 'owner', ''), 'Unassigned'),
        nullif(a ->> 'start', '')::date, nullif(a ->> 'due', '')::date, nullif(a ->> 'next', '')::date,
        nullif(a ->> 'closed', '')::date, nullif(a ->> 'remark', ''),
        case when nullif(a ->> 'source_status', '') is null then '{}'::jsonb
          else jsonb_build_object('status', a ->> 'source_status') end
      )
      on conflict (id) do update set
        manager = excluded.manager, program = excluded.program, description = excluded.description,
        dept = excluded.dept, customer = excluded.customer, owner = excluded.owner, member = excluded.member,
        start_date = excluded.start_date, due_date = excluded.due_date, next_date = excluded.next_date,
        closed_date = excluded.closed_date, remark = excluded.remark, custom = excluded.custom;
    exception when others then
      raise exception using errcode = sqlstate, message = v_label || ': ' || sqlerrm;
    end;
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

revoke all on function public.import_tasks(text, jsonb, jsonb) from public, anon;
grant execute on function public.import_tasks(text, jsonb, jsonb) to authenticated;

commit;
