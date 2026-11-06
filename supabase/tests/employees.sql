-- Run after migration 0015_employees.sql. Employee list access, sign-up sync and rename_owner.
-- All fixtures are rolled back.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.manager_id', gen_random_uuid()::text, true);
select set_config('test.admin_id', gen_random_uuid()::text, true);

insert into public.tasks (id, manager, program, description, owner) values
  ('EM-1', 'EM Manager',  'Employee Test', 'variant spelling',  'Brindle Oakes / Quillon Varga'),
  ('EM-2', 'EM Manager',  'Employee Test', 'variant only',      'Quillon Vargaa'),
  ('EM-3', 'EM Elsewhere','Employee Test', 'other tracker',     'Quillon Vargaa');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.owner_id')::uuid,   'authenticated', 'authenticated', 'em-owner-'   || replace(current_setting('test.owner_id'), '-', '')   || '@bremboindia.com', '', now(), '{}', '{"name":"Quillon Varga","department":"QE"}', now(), now()),
  (current_setting('test.manager_id')::uuid, 'authenticated', 'authenticated', 'em-manager-' || replace(current_setting('test.manager_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Em Manager Person"}', now(), now()),
  (current_setting('test.admin_id')::uuid,   'authenticated', 'authenticated', 'em-admin-'   || replace(current_setting('test.admin_id'), '-', '')   || '@bremboindia.com', '', now(), '{}', '{"name":"Em Admin Person"}', now(), now());
update public.profiles set role = 'manager', manager_name = 'EM Manager' where id = current_setting('test.manager_id')::uuid;
update public.profiles set role = 'admin' where id = current_setting('test.admin_id')::uuid;

-- Sign-up adds the person with their Outlook ID and department.
do $$
begin
  if not exists (select 1 from public.employees where name = 'Quillon Varga' and email like 'em-owner-%' and department = 'QE') then
    raise exception 'Sign-up should add the person to the employee list';
  end if;
end $$;

-- replace_owner_name keeps the order, removes duplicates and tidies separators.
do $$
begin
  if public.replace_owner_name('Brindle Oakes / quillon  vargaa', 'Quillon Vargaa', 'Quillon Varga') <> 'Brindle Oakes / Quillon Varga' then
    raise exception 'replace_owner_name failed: %', public.replace_owner_name('Brindle Oakes / quillon  vargaa', 'Quillon Vargaa', 'Quillon Varga');
  end if;
  if public.replace_owner_name('Quillon Vargaa, Quillon Varga', 'Quillon Vargaa', 'Quillon Varga') <> 'Quillon Varga' then
    raise exception 'replace_owner_name should merge duplicates';
  end if;
end $$;

set local role authenticated;

-- ── owner: reads the list, cannot change it or rename ──
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from public.employees where name = 'Quillon Varga') then
    raise exception 'Owner should read the employee list';
  end if;
  begin
    insert into public.employees (name) values ('Owner Added Person');
    raise exception 'Owner must not add employees';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rename_owner('Quillon Vargaa', 'Quillon Varga');
    raise exception 'Owner must not rename owners';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── manager: adds and edits people; rename changes only their own tracker ──
select set_config('request.jwt.claim.sub', current_setting('test.manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.manager_id'), 'role', 'authenticated')::text, true);
do $$
declare n integer;
begin
  insert into public.employees (name, email, department) values ('  Tamsin   Vey ', 'Tamsin.Vey@BremboIndia.com', 'PE');
  if not exists (select 1 from public.employees where name = 'Tamsin Vey' and email = 'tamsin.vey@bremboindia.com') then
    raise exception 'Employee name and email should be tidied';
  end if;
  begin
    insert into public.employees (name) values ('tamsin vey');
    raise exception 'Duplicate name must be refused';
  exception when unique_violation then null;
  end;
  update public.employees set department = 'QE' where name = 'Tamsin Vey';
  delete from public.employees where name = 'Tamsin Vey';
  if not exists (select 1 from public.employees where name = 'Tamsin Vey') then
    raise exception 'Manager must not delete employees (only deactivate)';
  end if;

  n := public.rename_owner('Quillon Vargaa', 'Quillon Varga');
  if n <> 1 then raise exception 'Manager rename should change 1 issue in their tracker, changed %', n; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  if (select owner from public.tasks where id = 'EM-2') <> 'Quillon Varga' then raise exception 'EM-2 not renamed'; end if;
  if (select owner from public.tasks where id = 'EM-3') <> 'Quillon Vargaa' then raise exception 'Other tracker must not change'; end if;
  if not exists (select 1 from public.task_events where task_id = 'EM-2' and action = 'update' and detail ? 'owner') then
    raise exception 'Rename should be recorded in the issue history';
  end if;
end $$;

-- ── admin: rename everywhere, delete people ──
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);
do $$
begin
  if public.rename_owner('quillon vargaa', 'Quillon Varga') <> 1 then raise exception 'Admin rename should reach the other tracker'; end if;
  delete from public.employees where name = 'Tamsin Vey';
  if exists (select 1 from public.employees where name = 'Tamsin Vey') then raise exception 'Admin delete failed'; end if;
end $$;

rollback;
