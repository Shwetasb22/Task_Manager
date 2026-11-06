-- Owners may upload evidence, but only a Manager/Admin may close an issue after review.

begin;

create or replace function public.guard_task_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.app_role();

  if v_role = 'owner'
     and new.closed_date is distinct from old.closed_date
     and new.closed_date is not null then
    raise exception using
      errcode = '42501',
      message = 'Owners can upload proof but cannot close issues. A Manager must review the proof.';
  end if;

  if v_role in ('admin', 'manager')
     and old.closed_date is null
     and new.closed_date is not null
     and not exists (
       select 1 from public.proofs as p where p.task_id = new.id
     ) then
    raise exception using
      errcode = '23514',
      message = 'Attach and review proof before closing this issue.';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_review_closure_trg on public.tasks;
create trigger tasks_review_closure_trg
  before update of closed_date on public.tasks
  for each row execute function public.guard_task_closure();

commit;
