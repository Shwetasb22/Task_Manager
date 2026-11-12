-- Sign-up with a role request. Owners are approved automatically (as before); a person who asks to
-- be a Manager waits until an Admin approves them and names their tracker. Admin is never a
-- sign-up option, and the role sent by the sign-up form is only ever a request.
-- Apply after 0031_admin_can_create_issues.sql. Existing users stay approved.
begin;

alter table public.profiles
  add column if not exists status text not null default 'approved',
  add column if not exists requested_role text,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('approved', 'pending', 'rejected'));

-- A person who is not approved has no role, so every row level security rule that asks
-- "what is your role?" answers "none". They can still read their own profile (to see the
-- waiting screen) because that policy compares the row id, not the role.
create or replace function public.app_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'approved'
$$;
create or replace function public.app_manager() returns text language sql stable security definer set search_path = public as $$
  select manager_name from public.profiles where id = auth.uid() and status = 'approved'
$$;
create or replace function public.app_owner() returns text language sql stable security definer set search_path = public as $$
  select owner_name from public.profiles where id = auth.uid() and status = 'approved'
$$;
create or replace function public.app_owner_aliases()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select owner_aliases from public.profiles where id = auth.uid() and role = 'owner' and status = 'approved'), '{}'::text[])
$$;

-- Sign-up metadata is untrusted. Only "owner" and "manager" can be requested; anything else
-- (including "admin") is treated as an owner request. A manager request starts as an owner
-- profile with status "pending", which has no access until an Admin approves it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data->>'name'), '');
  v_department text := nullif(btrim(new.raw_user_meta_data->>'department'), '');
  v_requested text := lower(coalesce(nullif(btrim(new.raw_user_meta_data->>'requested_role'), ''), 'owner'));
  v_owner_name text;
begin
  if v_name is null then
    raise exception using errcode = '22023', message = 'Enter your full name.';
  end if;
  if v_requested not in ('owner', 'manager') then
    v_requested := 'owner';
  end if;

  -- Display name in the tracker's own spelling when one matches exactly, else the signup name.
  select min(btrim(x)) into v_owner_name
  from public.tasks t, regexp_split_to_table(t.owner, '[[:space:]]*[/,&;+][[:space:]]*') x
  where public.norm_name(x) = public.norm_name(v_name);

  insert into public.profiles (id, email, name, role, manager_name, owner_name, department, owner_aliases, status, requested_role)
  values (new.id, new.email, v_name, 'owner', null, coalesce(v_owner_name, v_name), v_department,
          public.build_owner_aliases(v_name),
          case when v_requested = 'manager' then 'pending' else 'approved' end,
          v_requested)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Admin decision on a waiting request. Approving a manager needs the tracker name they will own.
create or replace function public.review_access_request(p_user uuid, p_approve boolean, p_tracker text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tracker text := nullif(btrim(p_tracker), '');
  v_status text;
  v_requested text;
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Only an admin can review access requests.';
  end if;

  select status, requested_role into v_status, v_requested
  from public.profiles where id = p_user for update;
  if not found or v_status is distinct from 'pending' then
    raise exception using errcode = '22023', message = 'This request is no longer waiting for review.';
  end if;

  if not p_approve then
    update public.profiles
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_user;
  elsif v_requested = 'manager' then
    if v_tracker is null then
      raise exception using errcode = '22023', message = 'Enter the tracker name for this manager.';
    end if;
    update public.profiles
    set role = 'manager', manager_name = v_tracker, owner_name = null, owner_aliases = '{}',
        status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_user;
  else
    update public.profiles
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_user;
  end if;
end;
$$;
revoke all on function public.review_access_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text) to authenticated;

commit;
