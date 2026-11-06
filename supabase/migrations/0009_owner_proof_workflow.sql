begin;

-- Owners may update only their own remark and status; managers may also reassign owner.
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
  if r = 'owner' then
    if (new.program, new.description, new.dept, new.owner, new.member, new.start_date,
        new.due_date, new.next_date, new.custom)
       is distinct from
       (old.program, old.description, old.dept, old.owner, old.member, old.start_date,
        old.due_date, old.next_date, old.custom) then
      raise exception 'Owners can only update remarks and status on their own actions';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.guard_task_closure()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := public.app_role();
begin
  if auth.uid() is null then return new; end if;
  if v_role in ('admin', 'manager', 'owner')
     and old.closed_date is null and new.closed_date is not null
     and not exists (select 1 from public.proofs p where p.task_id = new.id) then
    raise exception using errcode = '23514', message = 'Attach proof before closing this issue.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_manager_task_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.app_role() <> 'manager' then return new; end if;
  if row(new.id, new.manager, new.program, new.description, new.dept, new.member, new.start_date, new.custom, new.created_at)
     is distinct from row(old.id, old.manager, old.program, old.description, old.dept, old.member, old.start_date, old.custom, old.created_at) then
    raise exception using errcode = '42501', message = 'Managers may only update owner, due_date, next_date, closed_date, and remark.';
  end if;
  return new;
end;
$$;

commit;