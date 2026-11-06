-- Run after migrations 0001-0013 against a Supabase database.
-- Exercises manager/admin updates as authenticated users; fixtures are rolled back.
begin;

alter table public.tasks add column manager_update_future_test text;

select set_config('test.manager_id', gen_random_uuid()::text, true);
select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'Update Test ' || gen_random_uuid()::text, true);
select set_config('test.manager_name', 'Update Test Manager', true);
select set_config('test.task_id', 'update-allowlist-' || gen_random_uuid()::text, true);

insert into public.tasks (id, manager, program, description, owner)
values (current_setting('test.task_id'), current_setting('test.manager_name'), 'Security Test', 'Original description', current_setting('test.owner_name'));

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (current_setting('test.manager_id')::uuid, 'authenticated', 'authenticated', 'update-manager-' || replace(current_setting('test.manager_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.admin_id')::uuid, 'authenticated', 'authenticated', 'update-admin-' || replace(current_setting('test.admin_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now());

update public.profiles
set role = 'manager', manager_name = current_setting('test.manager_name')
where id = current_setting('test.manager_id')::uuid;
update public.profiles
set role = 'admin'
where id = current_setting('test.admin_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.manager_id'), 'role', 'authenticated')::text, true);

do $$
declare
  affected integer;
begin
  update public.tasks
  set due_date = date '2026-10-15', next_date = date '2026-10-10', remark = 'Manager edit allowed'
  where id = current_setting('test.task_id');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected manager allowed-column update to affect one task; got %', affected; end if;

  -- Managers may correct issue details in their own tracker (migration 0013).
  update public.tasks
  set description = 'Manager edit allowed', program = 'Renamed program', dept = 'QE', start_date = date '2026-10-01'
  where id = current_setting('test.task_id');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected manager detail edit to affect one task; got %', affected; end if;

  begin
    update public.tasks
    set custom = '{"x": 1}'::jsonb
    where id = current_setting('test.task_id');
    raise exception 'Expected manager update of custom to be denied';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%Managers may only update%' and sqlerrm not like '%cannot be changed here%' then raise; end if;
  end;

  begin
    update public.tasks
    set manager_update_future_test = 'Must be rejected'
    where id = current_setting('test.task_id');
    raise exception 'Expected manager update of a future column to be denied';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%Only admins may change fields outside%' and sqlerrm not like '%Managers may only update%' and sqlerrm not like '%cannot be changed here%' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);

do $$
declare
  affected integer;
begin
  update public.tasks
  set description = 'Admin edit remains allowed'
  where id = current_setting('test.task_id');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected admin update to affect one task; got %', affected; end if;
end;
$$;

reset role;
rollback;