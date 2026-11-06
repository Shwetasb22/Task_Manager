-- Run after the complete migration chain. Fixtures are rolled back.
begin;

select set_config('test.pm_id', gen_random_uuid()::text, true);
select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.pm_name', 'Platform Manager Test ' || left(gen_random_uuid()::text, 8), true);
select set_config('test.other_manager', 'Other Manager Test ' || left(gen_random_uuid()::text, 8), true);
select set_config('test.owner_name', 'Issue Owner Test ' || left(gen_random_uuid()::text, 8), true);
select set_config('test.null_due_id', 'PM-NULL-' || left(gen_random_uuid()::text, 8), true);
select set_config('test.timely_due_id', 'PM-TIMELY-' || left(gen_random_uuid()::text, 8), true);
select set_config('test.late_due_id', 'PM-LATE-' || left(gen_random_uuid()::text, 8), true);
select set_config('test.auto_due_id', 'PM-AUTO-' || left(gen_random_uuid()::text, 8), true);
select set_config('test.legacy_due_id', 'PM-LEGACY-' || left(gen_random_uuid()::text, 8), true);
select set_config('test.closed_id', 'PM-CLOSED-' || left(gen_random_uuid()::text, 8), true);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (current_setting('test.pm_id')::uuid, 'authenticated', 'authenticated', 'pm-' || replace(current_setting('test.pm_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.pm_name')), now(), now()),
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.admin_id')::uuid, 'authenticated', 'authenticated', 'admin-' || replace(current_setting('test.admin_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.pm_name')), now(), now());

update public.profiles set role = 'manager', manager_name = current_setting('test.pm_name'), access_approved = true
where id = current_setting('test.pm_id')::uuid;
update public.profiles
set role = 'owner', owner_name = current_setting('test.owner_name'),
    owner_aliases = array[current_setting('test.owner_name')], access_approved = true
where id = current_setting('test.owner_id')::uuid;
update public.profiles set role = 'admin', access_approved = true
where id = current_setting('test.admin_id')::uuid;

-- SQL maintenance can leave legacy null-due rows in place; authenticated edits must supply a date.
insert into public.tasks (id, manager, program, description, dept, owner, due_date)
values (current_setting('test.null_due_id'), current_setting('test.pm_name'), 'Policy Test', 'Legacy row', 'PE', current_setting('test.owner_name'), null);

-- Seed response-window fixtures as trusted SQL. Existing rows without proposal metadata stay accepted.
insert into public.tasks (id, manager, program, description, dept, owner, due_date, due_acceptance, due_proposed_at, created_at)
values
  (current_setting('test.timely_due_id'), current_setting('test.pm_name'), 'Policy Test', 'Timely response', 'PE', current_setting('test.owner_name'), current_date + 5, 'pending', now() - interval '1 day', now() - interval '1 day'),
  (current_setting('test.late_due_id'), current_setting('test.pm_name'), 'Policy Test', 'Late response', 'PE', current_setting('test.owner_name'), current_date + 5, 'pending', now() - interval '4 days', now() - interval '4 days'),
  (current_setting('test.auto_due_id'), current_setting('test.pm_name'), 'Policy Test', 'Auto-accept RPC', 'PE', current_setting('test.owner_name'), current_date + 5, 'pending', now() - interval '4 days', now() - interval '4 days'),
  (current_setting('test.legacy_due_id'), current_setting('test.pm_name'), 'Policy Test', 'Legacy accepted date', 'PE', current_setting('test.owner_name'), current_date + 5, null, null, now() - interval '10 days');

insert into public.tasks (id, manager, program, description, dept, owner, due_date, closed_date)
values (current_setting('test.closed_id'), current_setting('test.pm_name'), 'Policy Test', 'Closed issue lock', 'PE', current_setting('test.owner_name'), current_date + 5, current_date);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
do $$
declare v_state text;
begin
  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.pm_name'), 'Policy Test', 'Owner must not create', current_setting('test.owner_name'), current_date + 5);
    raise exception 'Expected owner issue creation to be denied';
  exception when insufficient_privilege then null;
  end;

  update public.tasks set due_acceptance = 'accepted'
  where id = current_setting('test.timely_due_id');
  if not found then raise exception 'Owner could not accept a pending target date within three days'; end if;

  update public.tasks set due_acceptance = 'rejected'
  where id = current_setting('test.late_due_id');
  if not found then raise exception 'Owner could not resolve an expired target-date proposal'; end if;
  select due_acceptance into v_state from public.tasks where id = current_setting('test.late_due_id');
  if v_state is distinct from 'auto_accepted' then raise exception 'Late owner response should be auto-accepted'; end if;

  update public.tasks set remark = 'owner can edit a closed issue' where id = current_setting('test.closed_id');
  if not found then raise exception 'Assigned owner could not edit a closed issue remark'; end if;
  begin
    update public.tasks set closed_date = null where id = current_setting('test.closed_id');
    raise exception 'Expected owner reopen to be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.pm_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.pm_id'), 'role', 'authenticated')::text, true);
do $$
declare v_id text; v_state text; v_count integer;
begin
  insert into public.tasks (manager, program, description, dept, owner, initial_manager, member, start_date, due_date)
  values (current_setting('test.pm_name'), 'Policy Test', 'Platform Manager can create', 'PE', current_setting('test.owner_name'), current_setting('test.pm_name'), 'Resource A', current_date, current_date + 5)
  returning id into v_id;
  if v_id is null or v_id = '' then raise exception 'Platform Manager insert did not generate an issue ID'; end if;
  perform set_config('test.created_id', v_id, true);

  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.other_manager'), 'Policy Test', 'Wrong tracker', current_setting('test.owner_name'), current_date + 5);
    raise exception 'Expected cross-tracker issue creation to be denied';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.tasks (manager, program, description, owner)
    values (current_setting('test.pm_name'), 'Policy Test', 'Missing target date', current_setting('test.owner_name'));
    raise exception 'Expected issue creation without target date to be denied';
  exception when check_violation then
    if sqlerrm not like '%Target date is required%' then raise; end if;
  end;

  begin
    update public.tasks set remark = 'must provide a target date'
    where id = current_setting('test.null_due_id');
    raise exception 'Expected editing a null-target issue to be denied';
  exception when check_violation then
    if sqlerrm not like '%Target date is required%' then raise; end if;
  end;

  perform public.auto_accept_due_dates();
  select due_acceptance into v_state from public.tasks where id = current_setting('test.auto_due_id');
  if v_state is distinct from 'auto_accepted' then raise exception 'Expired pending proposal was not auto-accepted'; end if;
  select due_acceptance into v_state from public.tasks where id = current_setting('test.legacy_due_id');
  if v_state is not null then raise exception 'Legacy date without recorded proposal must not be treated as pending'; end if;

  update public.tasks set red_flag = true where id = v_id;
  if not found then raise exception 'Platform Manager could not raise a Red Flag'; end if;
  select public.red_flag_count() into v_count;
  if v_count < 1 then raise exception 'System-wide Red Flag count did not include the new flag'; end if;

  begin
    update public.tasks set program = ' ' where id = v_id;
    raise exception 'Expected required Program to be protected from clearing';
  exception when check_violation then
    if sqlerrm not like '%Program is required%' then raise; end if;
  end;

  begin
    update public.tasks set custom = coalesce(custom, '{}'::jsonb) || '{"status":"Closed"}'::jsonb where id = v_id;
    raise exception 'Expected status-only closure to be denied';
  exception when check_violation then
    if sqlerrm not like '%explicit Close action%' then raise; end if;
  end;

  begin
    update public.tasks set next_date = due_date + 8 where id = v_id;
    raise exception 'Expected revised date beyond seven days to be denied';
  exception when check_violation then null;
  end;

  update public.tasks set next_date = due_date + 7 where id = v_id;
  if not found then raise exception 'A revised date exactly seven days after the target should be allowed'; end if;

  update public.tasks set remark = 'Manager can request revised proof' where id = current_setting('test.closed_id');
  if not found then raise exception 'Manager could not add a remark to a closed issue'; end if;
  begin
    update public.tasks set description = 'Manager edit before reopening' where id = current_setting('test.closed_id');
    raise exception 'Expected closed issue detail edit to be denied until reopened';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into public.tasks (manager, program, description, owner, due_date)
    values (current_setting('test.pm_name'), 'Policy Test', 'Admin cannot create', current_setting('test.owner_name'), current_date + 5);
    raise exception 'Expected Admin issue creation to be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
