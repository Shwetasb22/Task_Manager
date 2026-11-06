-- Permit an assigned Owner to update their issue after closure, while keeping
-- lifecycle control with managers. Managers may add a remark to a closed issue
-- or explicitly reopen it; other closed details remain locked.
begin;

create or replace function public.enforce_issue_edit_until_explicit_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_was_closed boolean;
  v_now_source_closed boolean;
  v_old_data jsonb;
  v_new_data jsonb;
begin
  -- Trusted maintenance and service-role jobs may reconcile historical rows.
  if auth.uid() is null then return new; end if;

  v_role := public.app_role();
  v_was_closed := old.closed_date is not null or lower(coalesce(old.custom ->> 'status', '')) = 'closed';
  v_now_source_closed := lower(coalesce(new.custom ->> 'status', '')) = 'closed';

  if v_was_closed then
    if v_role = 'owner' then
      -- RLS confirms the issue is still assigned to this Owner. Owners may edit
      -- details and remarks but cannot change the close marker or any status metadata.
      if new.closed_date is distinct from old.closed_date
         or coalesce(new.custom, '{}'::jsonb) is distinct from coalesce(old.custom, '{}'::jsonb) then
        raise exception using errcode = '42501',
          message = 'Owners can edit closed issue details but cannot reopen or change its status.';
      end if;
      return new;
    end if;

    if v_role in ('manager', 'dept_head', 'admin') then
      -- A manager can change only the remark while closed, or change lifecycle
      -- markers to reopen it. Other details require reopening first.
      v_old_data := to_jsonb(old) - array['closed_date', 'remark', 'updated_at', 'updated_by', 'custom'];
      v_new_data := to_jsonb(new) - array['closed_date', 'remark', 'updated_at', 'updated_by', 'custom'];
      if v_old_data is distinct from v_new_data
         or (coalesce(old.custom, '{}'::jsonb) - 'status') is distinct from (coalesce(new.custom, '{}'::jsonb) - 'status') then
        raise exception using errcode = '42501',
          message = 'Closed issue details are locked. Reopen the issue before editing them.';
      end if;
      if new.closed_date is not null
         and (coalesce(old.custom, '{}'::jsonb) ->> 'status') is distinct from (coalesce(new.custom, '{}'::jsonb) ->> 'status') then
        raise exception using errcode = '42501', message = 'Use the explicit Reopen action before changing a closed issue status.';
      end if;
      return new;
    end if;

    raise exception using errcode = '42501', message = 'You cannot edit this closed issue.';
  end if;

  -- Keep the existing edit-until-close contract for active issues: save details
  -- first, then use the explicit Close action as a separate operation.
  v_old_data := to_jsonb(old) - array['closed_date', 'updated_at', 'updated_by'];
  v_new_data := to_jsonb(new) - array['closed_date', 'updated_at', 'updated_by'];
  if new.closed_date is not null and v_old_data is distinct from v_new_data then
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

commit;
