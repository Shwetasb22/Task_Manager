-- Managers may edit only the task fields exposed by the application.
begin;

create or replace function public.guard_manager_task_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.app_role() <> 'manager' then
    return new;
  end if;

  if row(
       new.id, new.manager, new.program, new.description, new.dept, new.owner,
       new.member, new.start_date, new.custom, new.created_at
     ) is distinct from row(
       old.id, old.manager, old.program, old.description, old.dept, old.owner,
       old.member, old.start_date, old.custom, old.created_at
     ) then
    raise exception using
      errcode = '42501',
      message = 'Managers may only update due_date, next_date, closed_date, and remark.';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_manager_columns_guard_trg on public.tasks;
create trigger tasks_manager_columns_guard_trg
  before update on public.tasks
  for each row execute function public.guard_manager_task_columns();

commit;