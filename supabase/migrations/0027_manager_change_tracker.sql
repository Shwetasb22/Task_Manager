-- Manager change tracker (TM-001, TM-004/028, TM-005, TM-008/009, TM-021, TM-022, TM-027).
-- Apply after 0026. Safe to re-run.

begin;

-- ───────────── new columns ─────────────
alter table public.tasks add column if not exists initial_manager text;
alter table public.tasks add column if not exists red_flag boolean not null default false;
alter table public.tasks add column if not exists due_acceptance text
  check (due_acceptance is null or due_acceptance in ('pending', 'accepted', 'rejected', 'auto_accepted'));
alter table public.tasks add column if not exists due_proposed_at timestamptz;
alter table public.tasks add column if not exists due_accepted_at timestamptz;

update public.tasks
set initial_manager = coalesce(nullif(btrim(initial_manager), ''), manager)
where initial_manager is null or btrim(initial_manager) = '';

create index if not exists tasks_red_flag_idx on public.tasks (id) where red_flag is true;
create index if not exists tasks_due_acceptance_idx on public.tasks (due_acceptance) where due_acceptance = 'pending';

-- ───────────── TM-001: only a Platform Manager (manager) or Admin can create issues ─────────────
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check (
     (select public.app_role()) = 'admin'
  or ((select public.app_role()) = 'manager' and manager = (select public.app_manager()))
);

create or replace function public.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  new.program := btrim(coalesce(new.program, ''));
  new.description := btrim(coalesce(new.description, ''));
  new.owner := coalesce(nullif(btrim(new.owner), ''), 'Unassigned');
  new.dept := coalesce(nullif(btrim(new.dept), ''), 'Unassigned');
  new.initial_manager := coalesce(nullif(btrim(new.initial_manager), ''), nullif(btrim(new.manager), ''));
  new.red_flag := coalesce(new.red_flag, false);

  if new.manager is null or btrim(new.manager) = '' then
    raise exception using errcode = '23514', message = 'An issue must belong to a tracker.';
  end if;

  if auth.uid() is not null then
    r := public.app_role();
    if r is null or r not in ('admin', 'manager') then
      raise exception using errcode = '42501', message = 'Only a Platform Manager or Admin can add issues.';
    end if;
    if r = 'manager' and new.manager is distinct from public.app_manager() then
      raise exception using errcode = '42501', message = 'Managers can only add issues to their own tracker.';
    end if;
    if new.program = '' then
      raise exception using errcode = '23514', message = 'Program is required.';
    end if;
    if new.description = '' then
      raise exception using errcode = '23514', message = 'Issue description is required.';
    end if;
    if new.due_date is null then
      raise exception using errcode = '23514', message = 'Target date is required.';
    end if;
    if new.start_date is not null and new.due_date < new.start_date then
      raise exception using errcode = '23514', message = 'Target date cannot be before the start date.';
    end if;
    if new.next_date is not null and new.next_date > new.due_date + 7 then
      raise exception using errcode = '23514',
        message = 'The revised date cannot be more than 7 days after the target date.';
    end if;
    if new.closed_date is not null then
      raise exception using errcode = '23514',
        message = 'A new issue cannot be created as closed. Attach proof, then close it.';
    end if;
    if new.id is null or btrim(new.id) = '' then
      new.id := public.next_task_id(new.manager);
    end if;
    new.due_acceptance := coalesce(new.due_acceptance, 'pending');
    new.due_proposed_at := coalesce(new.due_proposed_at, now());
    new.updated_by := auth.uid();
  elsif new.id is null or btrim(new.id) = '' then
    new.id := public.next_task_id(new.manager);
  end if;

  return new;
end;
$$;

-- ───────────── due-date acceptance, 7-day revised window, red flag, required-field lock ─────────────
create or replace function public.guard_manager_task_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_allowed text[] := array['program', 'description', 'dept', 'customer', 'owner', 'member',
                            'start_date', 'due_date', 'next_date', 'closed_date', 'remark', 'custom',
                            'initial_manager', 'red_flag', 'due_acceptance', 'due_proposed_at',
                            'due_accepted_at', 'updated_at', 'updated_by'];
begin
  if auth.uid() is null then return new; end if;
  v_role := public.app_role();

  if v_role = 'owner' and old.closed_date is not null and new.closed_date is distinct from old.closed_date then
    raise exception using errcode = '42501',
      message = 'Only your manager can reopen a closed issue or change its close date.';
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception using errcode = '42501', message = 'The issue ID and tracker cannot be changed here.';
  end if;

  -- Setting a close date is an explicit Close action; a next/start date must never close the issue.
  if new.closed_date is distinct from old.closed_date and new.closed_date is not null
     and new.next_date is distinct from old.next_date then
    raise exception using errcode = '23514',
      message = 'A revised date does not close the issue. Use Close after proof is attached.';
  end if;

  if new.due_date is null and old.due_date is not null and new.closed_date is null then
    raise exception using errcode = '23514', message = 'Target date is required.';
  end if;
  if new.start_date is not null and new.due_date is not null and new.due_date < new.start_date then
    raise exception using errcode = '23514', message = 'Target date cannot be before the start date.';
  end if;
  if new.next_date is not null and new.due_date is not null and new.next_date > new.due_date + 7 then
    raise exception using errcode = '23514',
      message = 'The revised date cannot be more than 7 days after the target date.';
  end if;

  if new.due_date is distinct from old.due_date then
    if v_role = 'owner' then
      raise exception using errcode = '42501',
        message = 'Owners accept or reject the target date; they cannot change it.';
    end if;
    new.due_acceptance := 'pending';
    new.due_proposed_at := now();
    new.due_accepted_at := null;
  end if;

  if new.due_acceptance is distinct from old.due_acceptance then
    if new.due_acceptance in ('accepted', 'rejected') and v_role not in ('owner', 'admin', 'manager') then
      raise exception using errcode = '42501', message = 'Only the task owner can accept or reject the target date.';
    end if;
    if new.due_acceptance in ('accepted', 'auto_accepted') then
      new.due_accepted_at := coalesce(new.due_accepted_at, now());
    end if;
  end if;

  if v_role = 'owner' then
    if new.red_flag is distinct from old.red_flag then
      null; -- owners may flag their own visible issues
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.auto_accept_due_dates()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.tasks
  set due_acceptance = 'auto_accepted',
      due_accepted_at = coalesce(due_accepted_at, now()),
      updated_at = now()
  where closed_date is null
    and due_date is not null
    and coalesce(due_acceptance, 'pending') = 'pending'
    and coalesce(due_proposed_at, created_at, now()) <= now() - interval '3 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.auto_accept_due_dates() to authenticated;

-- ───────────── TM-022: authors may edit their own comments ─────────────
alter table public.task_comments add column if not exists edited_at timestamptz;

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update to authenticated
  using (author = (select auth.uid()))
  with check (author = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id));

create or replace function public.task_comments_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author is distinct from old.author or new.task_id is distinct from old.task_id then
    raise exception using errcode = '42501', message = 'A comment cannot be reassigned.';
  end if;
  new.body := btrim(new.body);
  if new.body = '' then
    raise exception using errcode = '23514', message = 'A comment cannot be empty.';
  end if;
  new.mentions := coalesce((select array_agg(distinct btrim(m)) from unnest(new.mentions) m where btrim(m) <> ''), '{}');
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists task_comments_before_update_trg on public.task_comments;
create trigger task_comments_before_update_trg before update on public.task_comments
  for each row execute function public.task_comments_before_update();

create or replace function public.task_comments_log_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.body is distinct from old.body then
    insert into public.task_events (task_id, actor, actor_name, action, detail, at)
    values (new.task_id, new.author, new.author_name, 'comment_edited',
            jsonb_build_object('comment_id', new.id, 'from', old.body, 'to', new.body, 'mentions', to_jsonb(new.mentions)), now());
  end if;
  return null;
end;
$$;
drop trigger if exists task_comments_log_update_trg on public.task_comments;
create trigger task_comments_log_update_trg after update on public.task_comments
  for each row execute function public.task_comments_log_update();

grant update on public.task_comments to authenticated;

commit;
