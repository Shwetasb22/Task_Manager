-- Platform Manager-only issue creation and required target dates on updates.
-- Apply after 0027_manager_change_tracker.sql. Existing legacy rows are not rewritten.
begin;

-- The Manager application role is the Platform Manager role. It may create issues only
-- inside the tracker named in its profile. Admins, department heads, and owners cannot insert.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    (select public.app_role()) = 'manager'
    and manager = (select public.app_manager())
  );

create or replace function public.require_platform_manager_task_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Keep trusted SQL maintenance/seed imports possible; authenticated app users are restricted.
  if auth.uid() is null then return new; end if;

  if (select public.app_role()) is distinct from 'manager' then
    raise exception using errcode = '42501', message = 'Only a Platform Manager can create a new issue.';
  end if;
  if new.manager is distinct from (select public.app_manager()) then
    raise exception using errcode = '42501', message = 'Platform Managers can only create issues in their own tracker.';
  end if;
  if new.due_date is null then
    raise exception using errcode = '23514', message = 'Target date is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_platform_manager_insert_guard on public.tasks;
create trigger tasks_platform_manager_insert_guard
  before insert on public.tasks
  for each row execute function public.require_platform_manager_task_creation();

create or replace function public.require_target_date_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.due_date is null then
    raise exception using errcode = '23514', message = 'Target date is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_target_date_required_update on public.tasks;
create trigger tasks_target_date_required_update
  before update on public.tasks
  for each row execute function public.require_target_date_on_update();

create or replace function public.enforce_due_acceptance_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null or new.due_acceptance is not distinct from old.due_acceptance then
    return new;
  end if;
  v_role := public.app_role();

  -- A manager's target-date change opens a fresh response window.
  if new.due_acceptance = 'pending'
     and new.due_date is distinct from old.due_date
     and v_role in ('manager', 'admin') then
    return new;
  end if;

  -- Only the assigned Owner may respond. If the window has expired, persist auto-acceptance
  -- instead of accepting a late rejection or changing the decision after the deadline.
  if new.due_acceptance in ('accepted', 'rejected') then
    if v_role <> 'owner' then
      raise exception using errcode = '42501', message = 'Only the task owner can respond to a target date.';
    end if;
    if old.due_acceptance <> 'pending' then
      raise exception using errcode = '42501', message = 'This target date is no longer awaiting a response.';
    end if;
    if old.due_proposed_at is null or old.due_proposed_at <= now() - interval '3 days' then
      new.due_acceptance := 'auto_accepted';
      new.due_accepted_at := coalesce(new.due_accepted_at, now());
    end if;
    return new;
  end if;

  -- The authenticated RPC may auto-accept only a pending proposal after the full response window.
  if new.due_acceptance = 'auto_accepted'
     and old.due_acceptance = 'pending'
     and old.due_proposed_at is not null
     and old.due_proposed_at <= now() - interval '3 days' then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'Invalid target-date response transition.';
end;
$$;

drop trigger if exists tasks_due_acceptance_window on public.tasks;
create trigger tasks_due_acceptance_window
  before update on public.tasks
  for each row execute function public.enforce_due_acceptance_window();

-- Do not treat legacy rows with no recorded proposal as pending responses.
create or replace function public.auto_accept_due_dates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.tasks
  set due_acceptance = 'auto_accepted',
      due_accepted_at = coalesce(due_accepted_at, now()),
      updated_at = now()
  where closed_date is null
    and due_date is not null
    and due_acceptance = 'pending'
    and due_proposed_at is not null
    and due_proposed_at <= now() - interval '3 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.auto_accept_due_dates() to authenticated;

-- Persist three-day automatic acceptance even when no app session is open, if pg_cron is enabled.
-- The application also invokes auto_accept_due_dates() on sign-in, tab focus, and every five minutes.
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
    exception
      when insufficient_privilege or undefined_file or feature_not_supported then
        null;
    end;
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select jobid from cron.job where jobname = $1 limit 1'
      into v_job_id using 'auto-accept-task-target-dates';
    if v_job_id is not null then
      execute 'select cron.unschedule($1)' using v_job_id;
    end if;
    execute 'select cron.schedule($1, $2, $3)'
      using 'auto-accept-task-target-dates', '*/15 * * * *', 'select public.auto_accept_due_dates();';
  end if;
end;
$$;

commit;
