-- Make the manager task update allow-list fail closed for future columns.
begin;

create or replace function public.guard_manager_task_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.app_role() is distinct from 'admin'
     and (to_jsonb(new) - array['due_date', 'next_date', 'closed_date', 'remark', 'updated_at', 'updated_by'])
       is distinct from
         (to_jsonb(old) - array['due_date', 'next_date', 'closed_date', 'remark', 'updated_at', 'updated_by']) then
    raise exception using
      errcode = '42501',
      message = 'Only admins may change fields outside due_date, next_date, closed_date, and remark.';
  end if;

  return new;
end;
$$;

commit;
