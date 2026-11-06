-- Migration 0009 replaced the fail-closed column guard from 0006 with a fixed column list,
-- so columns added later (for example tasks.customer from 0008) became editable by
-- managers and owners. Restore the fail-closed check. Issues are now managed entirely in
-- the app, so managers may also correct the issue details in their own tracker:
--   manager: program, description, dept, customer, owner, member, start_date, due_date,
--            next_date, closed_date, remark  (never id, manager, custom, created_at)
--   owner:   closed_date, remark (owners may close an issue with proof, but only a
--            manager/admin can reopen it and send it back to the owner)
begin;

create or replace function public.guard_manager_task_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_allowed text[];
begin
  if auth.uid() is null then return new; end if;
  v_role := public.app_role();
  if v_role = 'admin' then return new; end if;

  if v_role = 'manager' then
    v_allowed := array['program', 'description', 'dept', 'customer', 'owner', 'member', 'start_date',
                        'due_date', 'next_date', 'closed_date', 'remark', 'updated_at', 'updated_by'];
  else
    v_allowed := array['closed_date', 'remark', 'updated_at', 'updated_by'];
  end if;

  if v_role = 'owner' and old.closed_date is not null and new.closed_date is null then
    raise exception using errcode = '42501',
      message = 'Only your manager can reopen a closed issue.';
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    if v_role = 'manager' then
      raise exception using errcode = '42501',
        message = 'Managers may only update issue details, owner, dates and remark.';
    end if;
    raise exception using errcode = '42501',
      message = 'Owners can only update remarks and status on their own actions.';
  end if;
  return new;
end;
$$;

commit;
