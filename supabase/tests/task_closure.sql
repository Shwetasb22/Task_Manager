-- Run after migrations 0001-0013 against a Supabase database.
-- Exercises the policies as authenticated users; all fixtures are rolled back.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.manager_id', gen_random_uuid()::text, true);
select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'Closure Test ' || gen_random_uuid()::text, true);
select set_config('test.manager_name', 'Closure Test Manager', true);
select set_config('test.manager_task_id', 'closure-manager-' || gen_random_uuid()::text, true);
select set_config('test.admin_task_id', 'closure-admin-' || gen_random_uuid()::text, true);

insert into public.tasks (id, manager, program, description, owner)
values
  (current_setting('test.manager_task_id'), current_setting('test.manager_name'), 'Security Test', 'Manager closure fixture', current_setting('test.owner_name')),
  (current_setting('test.admin_task_id'), current_setting('test.manager_name'), 'Security Test', 'Admin closure fixture', current_setting('test.owner_name'));

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'closure-owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.manager_id')::uuid, 'authenticated', 'authenticated', 'closure-manager-' || replace(current_setting('test.manager_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.admin_id')::uuid, 'authenticated', 'authenticated', 'closure-admin-' || replace(current_setting('test.admin_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now());

update public.profiles
set role = 'manager', manager_name = current_setting('test.manager_name')
where id = current_setting('test.manager_id')::uuid;
update public.profiles
set role = 'admin'
where id = current_setting('test.admin_id')::uuid;

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);

insert into public.proofs (task_id, path, filename, mime, size, uploaded_by)
values
  (current_setting('test.manager_task_id'), current_setting('test.manager_task_id') || '/owner-proof.pdf', 'owner-proof.pdf', 'application/pdf', 1, auth.uid()),
  (current_setting('test.admin_task_id'), current_setting('test.admin_task_id') || '/owner-proof.pdf', 'owner-proof.pdf', 'application/pdf', 1, auth.uid());

do $$
declare affected integer;
begin
  -- Owners may close their own issue once proof is attached (migration 0009).
  update public.tasks
  set closed_date = current_date
  where id = current_setting('test.manager_task_id');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected owner closure with proof to succeed'; end if;

  -- ...but only a manager/admin can reopen it (migration 0013).
  begin
    update public.tasks
    set closed_date = null
    where id = current_setting('test.manager_task_id');
    raise exception 'Expected owner reopen to be denied';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%Only your manager can reopen%' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.manager_id'), 'role', 'authenticated')::text, true);

do $$
declare affected integer;
begin
  -- The owner's manager can reopen the closed issue and send it back.
  update public.tasks set closed_date = null where id = current_setting('test.manager_task_id');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected manager to reopen the owner-closed issue'; end if;
end;
$$;

update public.tasks
set closed_date = current_date
where id = current_setting('test.manager_task_id');

select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);

update public.tasks
set closed_date = current_date
where id = current_setting('test.admin_task_id');

reset role;
rollback;