-- Owners see and work on ALL their issues, from every manager's tracker.
--
-- Before: an owner saw an issue only when tasks.owner was exactly equal to profiles.owner_name.
-- Tracker Owner cells are free text, so most owners saw nothing:
--   * one cell can name several people        "Anjali Iyer / Chetan Salunke / Amit Jadhav"
--   * the same person is written differently  "Abhijit", "Mendki Abhijit", "Abhijeet Mendki"
--   * spellings differ between trackers       "Yogita Salunke" vs "Yogita Salunkhe"
-- and signup was refused when the name did not match a tracker value exactly.
--
-- After:
--   * every owner profile has owner_aliases (lower-case names). An issue belongs to the owner when
--     ANY name in its Owner cell equals ANY alias. Aliases are built automatically from the signup
--     name: full name, reversed name, first name, plus tracker spellings within 2 letters of the
--     full name. New tracker spellings are picked up automatically when issues are added or edited.
--   * signup always succeeds for an @bremboindia.com address; issues appear as soon as one is assigned.
--   * owners can add issues (to any tracker, assigned to themselves), import from Excel, and edit
--     every issue field except the tracker. Closing still needs proof; only a manager reopens.
--   * policies use (select ...) wrappers and a GIN index so access checks run once per query.
-- Apply after 0013. Safe to re-run.

begin;

create schema if not exists extensions;
create extension if not exists fuzzystrmatch with schema extensions;

alter table public.profiles add column if not exists owner_aliases text[] not null default '{}';

-- ───────────── name helpers ─────────────
create or replace function public.norm_name(p text)
returns text language sql immutable parallel safe as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p, '')), '[[:space:].]+', ' ', 'g')), '')
$$;

-- "Anjali Iyer / Amit Jadhav" -> {anjali iyer, amit jadhav}
create or replace function public.owner_tokens(p text)
returns text[] language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct t) filter (where t is not null), '{}'::text[])
  from (select public.norm_name(x) as t
        from regexp_split_to_table(coalesce(p, ''), '[[:space:]]*[/,&;+][[:space:]]*') as x) s
$$;

create index if not exists tasks_owner_tokens_idx on public.tasks using gin (public.owner_tokens(owner));

-- Default aliases for a person's name, plus tracker spellings that are clearly the same person.
create or replace function public.build_owner_aliases(p_name text, p_owner_name text default null)
returns text[] language plpgsql stable security definer set search_path = public, extensions as $$
declare
  n text := public.norm_name(p_name);
  w text[];
  out text[] := '{}';
  rev text;
begin
  if n is not null then
    w := string_to_array(n, ' ');
    out := array[n];
    if array_length(w, 1) > 1 then
      rev := w[array_length(w, 1)] || ' ' || w[1];
      out := out || rev;
      if array_length(w, 1) > 2 then out := out || (w[1] || ' ' || w[array_length(w, 1)]); end if;
    end if;
    out := out || w[1];

    -- "Yogita Salunkhe" also matches "Yogita Salunke": same first letter, at most 2 letters apart.
    if length(n) >= 8 then
      out := out || coalesce((
        select array_agg(distinct tok)
        from (select unnest(public.owner_tokens(t.owner)) as tok from public.tasks t) s
        where left(tok, 1) = left(n, 1)
          and (levenshtein(tok, n) <= 2
               or (rev is not null and levenshtein(tok, rev) <= 2))
      ), '{}');
    end if;
  end if;

  if public.norm_name(p_owner_name) is not null then
    out := out || public.norm_name(p_owner_name);
  end if;

  return (select coalesce(array_agg(distinct a), '{}') from unnest(out) a where a is not null);
end;
$$;

create or replace function public.app_owner_aliases()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select owner_aliases from public.profiles where id = auth.uid() and role = 'owner'), '{}'::text[])
$$;

-- ───────────── signup: never blocked by name spelling ─────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data->>'name'), '');
  v_department text := nullif(btrim(new.raw_user_meta_data->>'department'), '');
  v_owner_name text;
begin
  if v_name is null then
    raise exception using errcode = '22023', message = 'Enter your full name.';
  end if;

  -- Display name in the tracker's own spelling when one matches exactly, else the signup name.
  select min(btrim(x)) into v_owner_name
  from public.tasks t, regexp_split_to_table(t.owner, '[[:space:]]*[/,&;+][[:space:]]*') x
  where public.norm_name(x) = public.norm_name(v_name);

  insert into public.profiles (id, email, name, role, manager_name, owner_name, department, owner_aliases)
  values (new.id, new.email, v_name, 'owner', null, coalesce(v_owner_name, v_name), v_department,
          public.build_owner_aliases(v_name))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Aliases follow the name when an admin renames an owner or sets owner_name; an admin can also
-- edit owner_aliases directly (that edit is kept as is).
create or replace function public.profiles_refresh_aliases()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner'
     and (tg_op = 'INSERT' and coalesce(array_length(new.owner_aliases, 1), 0) = 0
          or tg_op = 'UPDATE' and new.owner_aliases is not distinct from old.owner_aliases
             and (new.name, new.owner_name, new.role) is distinct from (old.name, old.owner_name, old.role)) then
    new.owner_aliases := public.build_owner_aliases(new.name, new.owner_name);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_refresh_aliases_trg on public.profiles;
create trigger profiles_refresh_aliases_trg before insert or update on public.profiles
  for each row execute function public.profiles_refresh_aliases();

-- A new tracker spelling of an owner's name ("Yogita Salunke") is added to that owner's aliases.
create or replace function public.tasks_link_owner_spellings()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if tg_op = 'UPDATE' and new.owner is not distinct from old.owner then return null; end if;
  foreach tok in array public.owner_tokens(new.owner) loop
    update public.profiles p
    set owner_aliases = (select array_agg(distinct a) from unnest(p.owner_aliases || tok) a)
    where p.role = 'owner'
      and not (tok = any (p.owner_aliases))
      and length(public.norm_name(p.name)) >= 8
      and left(tok, 1) = left(public.norm_name(p.name), 1)
      and levenshtein(tok, public.norm_name(p.name)) <= 2;
  end loop;
  return null;
end;
$$;
drop trigger if exists tasks_link_owner_spellings_trg on public.tasks;
create trigger tasks_link_owner_spellings_trg after insert or update of owner on public.tasks
  for each row execute function public.tasks_link_owner_spellings();

-- Backfill: every existing owner gets aliases (keeps any owner_name an admin already set).
update public.profiles
set owner_aliases = public.build_owner_aliases(name, owner_name)
where role = 'owner';
update public.profiles set owner_name = name where role = 'owner' and owner_name is null;

-- ───────────── row level security ─────────────
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (
     (select public.app_role()) = 'admin'
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or ((select public.app_role()) = 'owner'   and public.owner_tokens(owner) && (select public.app_owner_aliases()))
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
     (select public.app_role()) = 'admin'
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or ((select public.app_role()) = 'owner'   and public.owner_tokens(owner) && (select public.app_owner_aliases()))
) with check (
     (select public.app_role()) = 'admin'
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or ((select public.app_role()) = 'owner'   and public.owner_tokens(owner) && (select public.app_owner_aliases()))
);

-- Owners may add an issue to any tracker, as long as it is assigned to them.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check (
     (select public.app_role()) = 'admin'
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
  or ((select public.app_role()) = 'owner'   and public.owner_tokens(owner) && (select public.app_owner_aliases()))
);

-- Trackers anyone may file an issue under (owners cannot read other people's profiles or rows).
create or replace function public.list_trackers()
returns setof text language sql stable security definer set search_path = public as $$
  select m from (
    select distinct manager as m from public.tasks
    union
    select manager_name from public.profiles where role = 'manager' and manager_name is not null
  ) s
  where auth.uid() is not null and m is not null and btrim(m) <> ''
  order by 1
$$;
revoke all on function public.list_trackers() from public, anon;
grant execute on function public.list_trackers() to authenticated;

-- ───────────── insert rules: owners may add too ─────────────
create or replace function public.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text;
begin
  new.program     := btrim(new.program);
  new.description := btrim(new.description);
  new.owner       := coalesce(nullif(btrim(new.owner), ''), 'Unassigned');
  new.dept        := coalesce(nullif(btrim(new.dept), ''), 'Unassigned');

  if new.manager is null or btrim(new.manager) = '' then
    raise exception using errcode = '23514', message = 'An issue must belong to a tracker.';
  end if;

  if auth.uid() is not null then
    r := public.app_role();
    if r is null or r not in ('admin', 'manager', 'owner') then
      raise exception using errcode = '42501', message = 'Your account cannot add issues.';
    end if;
    if r = 'owner' and not (public.owner_tokens(new.owner) && public.app_owner_aliases()) then
      raise exception using errcode = '42501',
        message = 'You can only add issues assigned to you. Put your name in the Owner field.';
    end if;
    if new.program = '' then
      raise exception using errcode = '23514', message = 'Program is required.';
    end if;
    if new.description = '' then
      raise exception using errcode = '23514', message = 'Issue description is required.';
    end if;
    if new.closed_date is not null then
      raise exception using errcode = '23514',
        message = 'A new issue cannot be created as closed. Attach proof, then close it.';
    end if;
    if new.start_date is not null and new.due_date is not null and new.due_date < new.start_date then
      raise exception using errcode = '23514', message = 'Target date cannot be before the start date.';
    end if;
    new.id := public.next_task_id(new.manager);
    new.updated_by := auth.uid();
  elsif new.id is null or btrim(new.id) = '' then
    new.id := public.next_task_id(new.manager);
  end if;

  return new;
end;
$$;

-- ───────────── update rules ─────────────
-- tasks_guard (0009) still blocked owners from editing details; column rules now live in
-- guard_manager_task_columns below, so tasks_guard keeps only the rules for every role.
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return new; end if;
  r := public.app_role();
  if r is null then raise exception 'No profile for this user'; end if;
  if new.id is distinct from old.id then raise exception 'Issue id cannot change'; end if;
  if r <> 'admin' and new.manager is distinct from old.manager then
    raise exception 'Only an admin can move an issue to another tracker';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- Fail-closed column allowlist (same idea as 0013). Managers and owners may edit every issue
-- field except id, tracker, custom and created_at. Owners may close (with proof) but not reopen
-- or change a close date.
create or replace function public.guard_manager_task_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_allowed text[] := array['program', 'description', 'dept', 'customer', 'owner', 'member', 'start_date',
                            'due_date', 'next_date', 'closed_date', 'remark', 'updated_at', 'updated_by'];
begin
  if auth.uid() is null then return new; end if;
  v_role := public.app_role();
  if v_role = 'admin' then return new; end if;

  if v_role = 'owner' and old.closed_date is not null and new.closed_date is distinct from old.closed_date then
    raise exception using errcode = '42501',
      message = 'Only your manager can reopen a closed issue or change its close date.';
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception using errcode = '42501',
      message = 'The issue ID and tracker cannot be changed here.';
  end if;
  return new;
end;
$$;

-- Notifications in the app read task_events; owners see events for any issue they can see (unchanged).

commit;
