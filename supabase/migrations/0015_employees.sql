-- Employee list: owners are picked from a list instead of typed, so one person always has one spelling.
--
-- * public.employees holds everyone who can own an issue (name, Outlook ID, department).
--   Everyone signed in can read it (for the owner dropdown); admins and managers maintain it.
-- * It is filled once from the existing accounts and from the names already used in the trackers.
--   Spelling variants of a name that is already listed ("Yogita Salunke" next to "Yogita Salunkhe")
--   are not added twice.
-- * New sign-ups are added automatically.
-- * public.rename_owner(from, to) changes one spelling to another in every issue the caller may edit,
--   so old variants can be cleaned up from the People page.
-- tasks.owner stays text, so nothing else in the app or the access rules changes.
-- Apply after 0014. Safe to re-run.

begin;

create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  email       text check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+$'),
  department  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists employees_name_key on public.employees (public.norm_name(name));
create unique index if not exists employees_email_key on public.employees (lower(email)) where email is not null;

create or replace function public.employees_tidy()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := regexp_replace(btrim(new.name), '[[:space:]]+', ' ', 'g');
  new.email := nullif(lower(btrim(new.email)), '');
  new.department := nullif(btrim(new.department), '');
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists employees_tidy_trg on public.employees;
create trigger employees_tidy_trg before insert or update on public.employees
  for each row execute function public.employees_tidy();

alter table public.employees enable row level security;
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
  using ((select auth.uid()) is not null);
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated
  with check ((select public.app_role()) in ('admin', 'manager'));
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using ((select public.app_role()) in ('admin', 'manager'))
  with check ((select public.app_role()) in ('admin', 'manager'));
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- ───────────── fill the list once ─────────────
-- 1. Everyone with an account.
insert into public.employees (name, email, department)
select distinct on (public.norm_name(p.name)) p.name, p.email, p.department
from public.profiles p
where public.norm_name(p.name) is not null
order by public.norm_name(p.name), p.created_at
on conflict do nothing;

-- 2. Names used in the trackers: full names first (most used first), then single names. A name is
--    skipped when it is clearly a listed person: same normalised name, the reversed name, a single
--    name that is part of a listed full name, or a spelling within 2 letters with the same first letter.
do $$
declare
  r record;
  rev text;
begin
  for r in
    select n, min(spelling) as spelling, sum(cnt) as uses
    from (
      select public.norm_name(x) as n, btrim(regexp_replace(x, '[[:space:]]+', ' ', 'g')) as spelling, count(*) as cnt
      from public.tasks t, regexp_split_to_table(t.owner, '[[:space:]]*[/,&;+][[:space:]]*') x
      group by 1, 2
    ) s
    where n is not null and n !~ '^(unassigned|tbd|na|n/a|-|all|team)$'
    group by n
    order by (n like '% %') desc, sum(cnt) desc, n
  loop
    rev := array_to_string(array(select w from unnest(string_to_array(r.n, ' ')) with ordinality as u(w, i) order by i desc), ' ');
    continue when exists (
      select 1 from public.employees e
      where public.norm_name(e.name) in (r.n, rev)
         or (r.n not like '% %' and r.n = any (string_to_array(public.norm_name(e.name), ' ')))
         or (length(r.n) >= 8 and left(public.norm_name(e.name), 1) = left(r.n, 1)
             and extensions.levenshtein(public.norm_name(e.name), r.n) <= 2)
    );
    insert into public.employees (name)
    values (case when r.spelling ~ '[A-Z]' then r.spelling else initcap(r.spelling) end)
    on conflict do nothing;
  end loop;
end $$;

-- ───────────── new sign-ups join the list ─────────────
create or replace function public.add_signup_to_employees()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.employees set email = coalesce(email, new.email), department = coalesce(department, new.department)
  where public.norm_name(name) = public.norm_name(new.name) and (email is null or lower(email) = lower(new.email));
  if not found and not exists (select 1 from public.employees where lower(email) = lower(new.email)) then
    insert into public.employees (name, email, department) values (new.name, new.email, new.department)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_add_employee_trg on public.profiles;
create trigger profiles_add_employee_trg after insert on public.profiles
  for each row execute function public.add_signup_to_employees();

-- ───────────── one spelling everywhere ─────────────
-- "Anjali / Yogita Salunke" with ('Yogita Salunke' -> 'Yogita Salunkhe') -> "Anjali / Yogita Salunkhe"
create or replace function public.replace_owner_name(p_owner text, p_from text, p_to text)
returns text language sql immutable parallel safe set search_path = public as $$
  select coalesce(string_agg(name, ' / ' order by first_pos), 'Unassigned')
  from (
    select min(pos) as first_pos, min(name) as name
    from (
      select pos, case when public.norm_name(x) = public.norm_name(p_from) then btrim(p_to) else btrim(x) end as name
      from regexp_split_to_table(coalesce(p_owner, ''), '[[:space:]]*[/,&;+][[:space:]]*') with ordinality as s(x, pos)
      where public.norm_name(x) is not null
    ) a
    group by public.norm_name(name)
  ) b
$$;

-- Runs with the caller's rights, so access rules decide which issues change (a manager changes
-- only their own tracker). Every change is recorded in the issue history as usual.
create or replace function public.rename_owner(p_from text, p_to text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_count integer;
begin
  if (select public.app_role()) not in ('admin', 'manager') then
    raise exception using errcode = '42501', message = 'Only admins and managers can rename owners.';
  end if;
  if public.norm_name(p_from) is null or public.norm_name(p_to) is null then
    raise exception using errcode = '22023', message = 'Enter both names.';
  end if;
  update public.tasks
  set owner = public.replace_owner_name(owner, p_from, p_to)
  where public.owner_tokens(owner) @> array[public.norm_name(p_from)]
    and public.replace_owner_name(owner, p_from, p_to) is distinct from owner;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.rename_owner(text, text) from public, anon;
grant execute on function public.rename_owner(text, text) to authenticated;

commit;
