-- Issue numbers are never reused.
-- Until now the next number was "highest number in the table + 1", so when the newest issue of a
-- tracker was deleted, the next new issue got the same number again (an old printout or email could
-- then point at a different issue). Each prefix now has a counter that only goes up: it remembers
-- the highest number ever handed out or imported, also after that issue is deleted.
-- Numbers of issues deleted BEFORE this update cannot be known any more; the counters start from
-- the highest number in the table today.
-- Apply after 0023. Safe to re-run.
begin;

create table if not exists public.task_id_counters (
  prefix  text primary key,
  last_no integer not null check (last_no >= 0)
);
-- Only the functions below use it (security definer); the app's API cannot read or change it.
alter table public.task_id_counters enable row level security;
revoke all on public.task_id_counters from anon, authenticated;

-- Start each counter at the highest number in use today (never lower an existing counter).
insert into public.task_id_counters (prefix, last_no)
select split_part(t.id, '-', 1), max(split_part(t.id, '-', 2)::integer)
from public.tasks as t
where t.id ~ '^[A-Za-z]+-[0-9]{1,9}$'
group by 1
on conflict (prefix) do update set last_no = greatest(public.task_id_counters.last_no, excluded.last_no);

create or replace function public.next_task_id(p_manager text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next   integer;
begin
  select split_part(t.id, '-', 1) into v_prefix
  from public.tasks as t
  where t.manager = p_manager and t.id ~ '^[A-Za-z]+-[0-9]+$'
  limit 1;

  if v_prefix is null then
    select upper(string_agg(left(w, 1), '')) into v_prefix
    from regexp_split_to_table(regexp_replace(btrim(p_manager), '[^A-Za-z ]', '', 'g'), '\s+') as w
    where w <> '';
    if v_prefix is null or length(v_prefix) < 2 then
      v_prefix := upper(left(regexp_replace(coalesce(p_manager, 'XX'), '[^A-Za-z]', '', 'g') || 'XX', 2));
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('tasks_next_id:' || v_prefix));

  -- Highest of: the counter, and what is in the table (covers rows added before the counter existed).
  select greatest(
           coalesce((select c.last_no from public.task_id_counters c where c.prefix = v_prefix), 0),
           coalesce(max(substr(t.id, length(v_prefix) + 2)::integer), 0)
         ) + 1
  into v_next
  from public.tasks as t
  where t.id like v_prefix || '-%'
    and substr(t.id, length(v_prefix) + 2) ~ '^[0-9]{1,9}$';

  insert into public.task_id_counters (prefix, last_no) values (v_prefix, v_next)
  on conflict (prefix) do update set last_no = greatest(public.task_id_counters.last_no, excluded.last_no);

  return v_prefix || '-' || v_next;
end;
$$;

-- Issues saved with a number already given (Excel import, SQL Editor) move the counter up too.
create or replace function public.tasks_bump_id_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id ~ '^[A-Za-z]+-[0-9]{1,9}$' then
    insert into public.task_id_counters (prefix, last_no)
    values (split_part(new.id, '-', 1), split_part(new.id, '-', 2)::integer)
    on conflict (prefix) do update set last_no = greatest(public.task_id_counters.last_no, excluded.last_no);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_bump_id_counter_trg on public.tasks;
create trigger tasks_bump_id_counter_trg
  after insert on public.tasks
  for each row execute function public.tasks_bump_id_counter();

commit;
