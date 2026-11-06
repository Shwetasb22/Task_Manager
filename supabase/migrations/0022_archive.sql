-- Archive: issues closed more than a year ago are kept in the database but no longer downloaded when
-- the app opens, so it stays quick as years of history pile up. "Show archived" in the Task Register
-- fetches them when someone needs them. Reopening an archived issue brings it back automatically.
-- Archiving runs every Sunday night from the server (scripts/archive.mjs) or from the admin Lists page.
-- Apply after 0021. Safe to re-run.

begin;

alter table public.tasks add column if not exists archived_at timestamptz;
create index if not exists tasks_live_idx on public.tasks (id) where archived_at is null;

-- Reopened (or close date removed) means live again. Named zz_ so it runs after the role checks,
-- which therefore never see archived_at change.
create or replace function public.tasks_unarchive() returns trigger
language plpgsql as $$
begin
  if new.closed_date is null and new.archived_at is not null then
    new.archived_at := null;
  end if;
  return new;
end $$;
drop trigger if exists zz_tasks_unarchive_trg on public.tasks;
create trigger zz_tasks_unarchive_trg before update on public.tasks
  for each row execute function public.tasks_unarchive();

-- The History ignores archived_at: archiving is housekeeping, not a change to the issue.
-- (Same as 0001 otherwise.)
create or replace function public.tasks_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old) - array['updated_at','updated_by','archived_at'];
  n jsonb := to_jsonb(new) - array['updated_at','updated_by','archived_at'];
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

-- Archives issues closed more than p_days ago. Admins, or the server (service role / SQL) only.
-- Returns how many issues were archived. The History does not record archiving.
create or replace function public.archive_closed_tasks(p_days integer default 365)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is not null and public.app_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only an admin can archive issues.';
  end if;
  if p_days is null or p_days < 90 then
    raise exception using errcode = '22023', message = 'Only issues closed at least 90 days ago can be archived.';
  end if;
  update public.tasks set archived_at = now()
  where archived_at is null and closed_date is not null and closed_date < current_date - p_days;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.archive_closed_tasks(integer) from public, anon;
grant execute on function public.archive_closed_tasks(integer) to authenticated;

-- How many issues would be archived now (for the admin page).
create or replace function public.archive_candidates(p_days integer default 365)
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::integer from public.tasks
  where archived_at is null and closed_date is not null and closed_date < current_date - p_days
$$;
grant execute on function public.archive_candidates(integer) to authenticated;

commit;
