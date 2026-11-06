-- Run after migration 0030_closed_owner_edits_manager_review.sql. All fixtures roll back.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.manager_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'Closed Edit Owner ' || left(gen_random_uuid()::text, 8), true);
select set_config('test.manager_name', 'Closed Edit Manager ' || left(gen_random_uuid()::text, 8), true);
select set_config('test.closed_id', 'CE-CLOSED-' || left(gen_random_uuid()::text, 8), true);
select set_config('test.open_id', 'CE-OPEN-' || left(gen_random_uuid()::text, 8), true);

insert into public.tasks (id, manager, program, description, dept, owner, start_date, due_date, closed_date)
values
  (current_setting('test.closed_id'), current_setting('test.manager_name'), 'Closed Edit Test', 'Closed fixture', 'PE', current_setting('test.owner_name'), current_date - 2, current_date + 8, current_date - 1),
  (current_setting('test.open_id'), current_setting('test.manager_name'), 'Closed Edit Test', 'Open fixture', 'PE', current_setting('test.owner_name'), current_date - 2, current_date + 8, null);

insert into public.proofs (task_id, path, filename, mime, size)
values
  (current_setting('test.closed_id'), current_setting('test.closed_id') || '/' || gen_random_uuid()::text || '-closed.pdf', 'closed.pdf', 'application/pdf', 10),
  (current_setting('test.open_id'), current_setting('test.open_id') || '/' || gen_random_uuid()::text || '-open.pdf', 'open.pdf', 'application/pdf', 10);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'ce-owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.manager_id')::uuid, 'authenticated', 'authenticated', 'ce-manager-' || replace(current_setting('test.manager_id'), '-', '') || '@bremboindia.com', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.manager_name')), now(), now());

update public.profiles
set role = 'owner', owner_name = current_setting('test.owner_name'),
    owner_aliases = array[lower(current_setting('test.owner_name'))], access_approved = true
where id = current_setting('test.owner_id')::uuid;
update public.profiles
set role = 'manager', manager_name = current_setting('test.manager_name'), access_approved = true
where id = current_setting('test.manager_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);

do $$
declare v_description text;
begin
  update public.tasks set description = 'Owner edited the closed details', remark = 'Please review the new proof'
  where id = current_setting('test.closed_id');
  if not found then raise exception 'Assigned owner could not edit the closed issue'; end if;
  select description into v_description from public.tasks where id = current_setting('test.closed_id');
  if v_description <> 'Owner edited the closed details' then raise exception 'Owner edit was not persisted'; end if;

  begin
    update public.tasks set closed_date = null where id = current_setting('test.closed_id');
    raise exception 'Owner must not reopen a closed issue';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.manager_id'), 'role', 'authenticated')::text, true);

do $$
declare v_description text;
begin
  update public.tasks set remark = 'Manager requests corrected evidence' where id = current_setting('test.closed_id');
  if not found then raise exception 'Manager could not add a remark to a closed issue'; end if;

  begin
    update public.tasks set description = 'Manager detail edit while closed' where id = current_setting('test.closed_id');
    raise exception 'Manager must reopen before editing closed details';
  exception when insufficient_privilege then null;
  end;

  update public.tasks set closed_date = null, custom = coalesce(custom, '{}'::jsonb) || '{"status":"Open"}'::jsonb
  where id = current_setting('test.closed_id');
  if not found then raise exception 'Manager could not reopen the closed issue'; end if;

  update public.tasks set description = 'Manager edited after reopening' where id = current_setting('test.closed_id');
  select description into v_description from public.tasks where id = current_setting('test.closed_id');
  if v_description <> 'Manager edited after reopening' then raise exception 'Manager edit after reopening did not persist'; end if;

  update public.tasks set closed_date = current_date where id = current_setting('test.open_id');
  if not found then raise exception 'Manager could not close an issue with proof'; end if;
end $$;

reset role;
rollback;
