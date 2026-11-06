-- Issue edit-until-close lock, global red-flag aggregate, and retirement of daily email digests.
-- Apply after 0028. Safe to re-run.
begin;

create or replace function public.enforce_issue_edit_until_explicit_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_closed boolean;
  v_now_source_closed boolean;
  v_old_data jsonb;
  v_new_data jsonb;
begin
  -- Trusted maintenance and scheduled service-role jobs may still reconcile historical rows.
  if auth.uid() is null then return new; end if;

  v_was_closed := old.closed_date is not null or lower(coalesce(old.custom ->> 'status', '')) = 'closed';
  v_now_source_closed := lower(coalesce(new.custom ->> 'status', '')) = 'closed';
  v_old_data := to_jsonb(old) - array['closed_date', 'updated_at', 'updated_by'];
  v_new_data := to_jsonb(new) - array['closed_date', 'updated_at', 'updated_by'];

  if v_was_closed then
    -- Reopen is a separate explicit lifecycle action; only the source-status marker may change with it.
    if (v_old_data - 'custom') is distinct from (v_new_data - 'custom')
       or (coalesce(old.custom, '{}'::jsonb) - 'status') is distinct from (coalesce(new.custom, '{}'::jsonb) - 'status') then
      raise exception using errcode = '42501',
        message = 'This issue is closed. Reopen it before editing details.';
    end if;
    if old.closed_date is not null and new.closed_date is not null
       and (coalesce(old.custom, '{}'::jsonb) ->> 'status') is distinct from (coalesce(new.custom, '{}'::jsonb) ->> 'status') then
      raise exception using errcode = '42501', message = 'Use the explicit Reopen action before changing a closed issue.';
    end if;
  elsif new.closed_date is not null and v_old_data is distinct from v_new_data then
    raise exception using errcode = '23514',
      message = 'Save issue details before using the explicit Close action.';
  elsif v_now_source_closed then
    raise exception using errcode = '23514',
      message = 'Use the explicit Close action to close an issue.';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_edit_until_explicit_close on public.tasks;
create trigger tasks_edit_until_explicit_close
before update on public.tasks
for each row execute function public.enforce_issue_edit_until_explicit_close();

create or replace function public.protect_required_task_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.manager is distinct from old.manager and coalesce(btrim(new.manager), '') = '' then
    raise exception using errcode = '23514', message = 'Manager is required.';
  end if;
  if new.program is distinct from old.program and coalesce(btrim(new.program), '') = '' then
    raise exception using errcode = '23514', message = 'Program is required.';
  end if;
  if new.description is distinct from old.description and coalesce(btrim(new.description), '') = '' then
    raise exception using errcode = '23514', message = 'Issue description is required.';
  end if;
  if new.dept is distinct from old.dept and coalesce(btrim(new.dept), '') = '' then
    raise exception using errcode = '23514', message = 'Department is required.';
  end if;
  if new.owner is distinct from old.owner and coalesce(btrim(new.owner), '') = '' then
    raise exception using errcode = '23514', message = 'Owner is required.';
  end if;
  if new.start_date is distinct from old.start_date and new.start_date is null then
    raise exception using errcode = '23514', message = 'Start date is required.';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_protect_required_fields on public.tasks;
create trigger tasks_protect_required_fields
before update on public.tasks
for each row execute function public.protect_required_task_fields();

create or replace function public.protect_revised_date_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.next_date is not null and new.due_date is not null and new.next_date > new.due_date + 7 then
      raise exception using errcode = '23514', message = 'The revised date cannot be more than 7 days after the target date.';
    end if;
  elsif (new.next_date is distinct from old.next_date or new.due_date is distinct from old.due_date)
        and new.next_date is not null and new.due_date is not null and new.next_date > new.due_date + 7 then
    raise exception using errcode = '23514', message = 'The revised date cannot be more than 7 days after the target date.';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_revised_date_window on public.tasks;
create trigger tasks_revised_date_window
before insert or update on public.tasks
for each row execute function public.protect_revised_date_window();

create or replace function public.prevent_issue_insert_as_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and (new.closed_date is not null or lower(coalesce(new.custom ->> 'status', '')) = 'closed') then
    raise exception using errcode = '23514', message = 'Use the explicit Close action after the issue has been created.';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_prevent_insert_as_closed on public.tasks;
create trigger tasks_prevent_insert_as_closed
before insert on public.tasks
for each row execute function public.prevent_issue_insert_as_closed();

create or replace function public.red_flag_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.tasks where red_flag is true;
$$;
grant execute on function public.red_flag_count() to authenticated;

-- Routine morning meeting emails are retired; retain weekly report preferences and delivery.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'notify_daily'
  ) then
    execute 'update public.profiles set notify_daily = false where notify_daily is distinct from false';
  end if;
end;
$$;

commit;
