-- Owner signup safety and automatic exact-name tracker matching.
-- Apply after 0001_init.sql. No service-role key is used by the client.

begin;

alter table public.profiles
  add column if not exists department text;

-- Enforce the organization domain in Postgres, including direct Auth API calls.
create or replace function public.enforce_bremboindia_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(btrim(new.email)) !~ '^[^@]+@bremboindia[.]com$' then
    raise exception using
      errcode = '23514',
      message = 'Sign-up is limited to @bremboindia.com email addresses.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_bremboindia_email_trg on auth.users;
create trigger enforce_bremboindia_email_trg
  before insert or update of email on auth.users
  for each row execute function public.enforce_bremboindia_email();

-- Signup metadata is untrusted: role is always owner and the submitted name must
-- exactly or uniquely match a tracker Owner value before access is granted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data->>'name'), '');
  v_department text := nullif(btrim(new.raw_user_meta_data->>'department'), '');
  v_first_name text;
  v_owner_name text;
  v_match_count integer;
begin
  if v_name is null then
    raise exception using
      errcode = '22023',
      message = 'Enter your name exactly as it appears in the tracker Owner column.';
  end if;

  select count(distinct t.owner), min(t.owner)
  into v_match_count, v_owner_name
  from public.tasks as t
  where lower(btrim(t.owner)) = lower(v_name);

  if v_match_count = 0 then
    v_first_name := split_part(regexp_replace(v_name, '\s+', ' ', 'g'), ' ', 1);
    select count(distinct t.owner), min(t.owner)
    into v_match_count, v_owner_name
    from public.tasks as t
    where lower(btrim(t.owner)) = lower(v_first_name);
  end if;

  if v_match_count = 0 or v_owner_name is null then
    raise exception using
      errcode = '22023',
      message = 'The signup name does not match an Owner value in the tracker.';
  elsif v_match_count > 1 then
    raise exception using
      errcode = '22023',
      message = 'The signup first name matches multiple tracker owners. Contact your administrator to resolve the name.';
  end if;

  insert into public.profiles (id, email, name, role, manager_name, owner_name, department)
  values (
    new.id,
    new.email,
    v_name,
    'owner',
    null,
    v_owner_name,
    v_department
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Remove the previous approval flow if this migration was already run from the SQL Editor.
drop policy if exists profiles_select_pending_owners on public.profiles;
drop function if exists public.approve_owner_access(uuid, text);

-- Backfill existing pending profiles using exact match first, then a unique first-name
-- match. Ambiguous or unmatched accounts remain unmapped and see no tasks.
do $$
declare
  v_profile record;
  v_first_name text;
  v_owner_name text;
  v_match_count integer;
begin
  for v_profile in
    select p.id, p.name
    from public.profiles as p
    where p.role = 'owner'
      and (
        p.owner_name is null
        or not exists (select 1 from public.tasks as t where t.owner = p.owner_name)
      )
  loop
    select count(distinct t.owner), min(t.owner)
    into v_match_count, v_owner_name
    from public.tasks as t
    where lower(btrim(t.owner)) = lower(btrim(v_profile.name));

    if v_match_count = 0 then
      v_first_name := split_part(regexp_replace(btrim(v_profile.name), '\s+', ' ', 'g'), ' ', 1);
      select count(distinct t.owner), min(t.owner)
      into v_match_count, v_owner_name
      from public.tasks as t
      where lower(btrim(t.owner)) = lower(v_first_name);
    end if;

    if v_match_count = 1 then
      update public.profiles
      set owner_name = v_owner_name
      where id = v_profile.id;
    end if;
  end loop;
end;
$$;

commit;
