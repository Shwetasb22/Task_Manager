-- Admins (for example Vishal Shinde) may create and import issues in any tracker, as well as
-- Platform Managers in their own tracker. Owners and department heads still cannot insert.
-- Apply after 0030_closed_owner_edits_manager_review.sql.
begin;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    (select public.app_role()) = 'admin'
    or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
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

  if (select public.app_role()) not in ('manager', 'admin') then
    raise exception using errcode = '42501', message = 'Only a Platform Manager or Admin can create a new issue.';
  end if;
  if (select public.app_role()) = 'manager' and new.manager is distinct from (select public.app_manager()) then
    raise exception using errcode = '42501', message = 'Platform Managers can only create issues in their own tracker.';
  end if;
  if new.due_date is null then
    raise exception using errcode = '23514', message = 'Target date is required.';
  end if;
  return new;
end;
$$;

commit;
