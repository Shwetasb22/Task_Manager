-- Run after the complete migration chain. Authenticated issue creation is Platform Manager-only.
-- All fixtures are rolled back.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.manager_id', gen_random_uuid()::text, true);
select set_config('test.other_manager_id', gen_random_uuid()::text, true);
select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'AddIssue Test ' || gen_random_uuid()::text, true);
select set_config('test.manager_name', 'Zed Quark', true);
select set_config('test.other_manager_name', 'Other Tracker Test', true);

insert into public.tasks (id, manager, program, description, owner)
values
  ('ZQ-3', current_setting('test.manager_name'), 'Add Issue Test', 'Existing fixture', current_setting('test.owner_name')),
  ('ZQ-7', current_setting('test.manager_name'), 'Add Issue Test', 'Existing fixture', current_setting('test.owner_name')),
  ('OT-1', current_setting('test.other_manager_name'), 'Add Issue Test', 'Existing fixture', current_setting('test.owner_name'));

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'addissue-owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.manager_id')::uuid, 'authenticated', 'authenticated', 'addissue-manager-' || replace(current_setting('test.manager_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.other_manager_id')::uuid, 'authenticated', 'authenticated', 'addissue-other-' || replace(current_setting('test.other_manager_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.admin_id')::uuid, 'authenticated', 'authenticated', 'addissue-admin-' || replace(current_setting('test.admin_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now());

update public.profiles set role = 'manager', manager_name = current_setting('test.manager_name'), access_approved = true
where id = current_setting('test.manager_id')::uuid;
update public.profiles set role = 'manager', manager_name = current_setting('test.other_manager_name'), access_approved = true
where id = current_setting('test.other_manager_id')::uuid;
update public.profiles set role = 'admin', access_approved = true
where id = current_setting('test.admin_id')::uuid;

set local role authenticated;

-- Owners cannot create issues, even one assigned to themselves.
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.manager_name'), 'Add Issue Test', 'Owner must not create', current_setting('test.owner_name'), current_date + 5);
    raise exception 'Expected owner issue creation to be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A Platform Manager can add only to their own tracker; IDs are assigned by the database.
select set_config('request.jwt.claim.sub', current_setting('test.manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.manager_id'), 'role', 'authenticated')::text, true);
do $$
declare v_first text; v_second text; v_desc text; v_events integer;
begin
  insert into public.tasks (manager, program, description, dept, owner, start_date, due_date)
  values (current_setting('test.manager_name'), '  Add Issue Test  ', '   Padded description   ', 'PE', 'Someone', current_date, current_date + 5)
  returning id, description into v_first, v_desc;
  if v_first <> 'ZQ-8' then raise exception 'Expected ZQ-8 but got %', v_first; end if;
  if v_desc <> 'Padded description' then raise exception 'Description was not trimmed: [%]', v_desc; end if;

  insert into public.tasks (manager, program, description, dept, owner, due_date)
  values (current_setting('test.manager_name'), 'Add Issue Test', 'Second issue', 'PE', 'Someone', current_date + 10)
  returning id into v_second;
  if v_second <> 'ZQ-9' then raise exception 'Expected ZQ-9 but got %', v_second; end if;

  select count(*) into v_events from public.task_events where task_id = v_first and action = 'created';
  if v_events <> 1 then raise exception 'Expected one created event for %, got %', v_first, v_events; end if;

  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.other_manager_name'), 'Add Issue Test', 'Wrong tracker', 'Someone', current_date + 5);
    raise exception 'Expected cross-tracker insert to be denied';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.tasks (manager, program, description, owner)
    values (current_setting('test.manager_name'), 'Add Issue Test', 'Missing target date', 'Someone');
    raise exception 'Expected issue creation without target date to be denied';
  exception when check_violation then
    if sqlerrm not like '%Target date is required%' then raise; end if;
  end;

  begin
    insert into public.tasks (manager, program, description, owner, start_date, due_date)
    values (current_setting('test.manager_name'), 'Add Issue Test', 'Backwards dates', 'Someone', current_date, current_date - 1);
    raise exception 'Expected backwards dates to be denied';
  exception when check_violation then
    if sqlerrm not like '%before the start date%' then raise; end if;
  end;

  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.manager_name'), '   ', 'No program', 'Someone', current_date + 5);
    raise exception 'Expected blank program to be denied';
  exception when check_violation then null;
  end;
end $$;

-- Other managers cannot see the created issue rows.
select set_config('request.jwt.claim.sub', current_setting('test.other_manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.other_manager_id'), 'role', 'authenticated')::text, true);
do $$
declare v integer;
begin
  select count(*) into v from public.tasks where id in ('ZQ-8', 'ZQ-9');
  if v <> 0 then raise exception 'Other manager can see % new rows', v; end if;
end $$;

-- Admins cannot create issues; creation belongs exclusively to Platform Managers.
select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.manager_name'), 'Add Issue Test', 'Admin cannot create', 'Someone', current_date + 5);
    raise exception 'Expected Admin issue creation to be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
