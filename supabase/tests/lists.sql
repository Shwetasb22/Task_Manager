-- Run after migration 0021_lists.sql. Trackers and departments are managed lists: admins rename and
-- merge them for every issue at once; nobody else can, and issues cannot point to a phantom tracker.
-- All fixtures are rolled back.
begin;

select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.mgr_id', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.admin_id')::uuid, 'authenticated', 'authenticated', 'ls-admin-' || replace(current_setting('test.admin_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"LS Admin"}', now(), now()),
  (current_setting('test.mgr_id')::uuid, 'authenticated', 'authenticated', 'ls-mgr-' || replace(current_setting('test.mgr_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"LS Manager"}', now(), now());
update public.profiles set role = 'admin', owner_name = null where id = current_setting('test.admin_id')::uuid;
update public.profiles set role = 'manager', owner_name = null, manager_name = 'LS Tracker' where id = current_setting('test.mgr_id')::uuid;

insert into public.tasks (id, manager, program, description, dept, owner, due_date) values
  ('LS-1', 'LS Tracker', 'Lists Test', 'one', 'LSENGG', 'Ona Pell', current_date + 5),
  ('LS-2', 'LS Tracker', 'Lists Test', 'two', 'LSPE',   'Ona Pell', current_date + 5),
  ('LS-3', 'LS Old',     'Lists Test', 'three', 'LSENGG', 'Ona Pell', current_date + 5);

do $$ begin
  if not exists (select 1 from public.trackers where name = 'LS Tracker') then raise exception 'Tracker not created from the profile'; end if;
  if not exists (select 1 from public.trackers where name = 'LS Old') then raise exception 'Tracker not created by an SQL insert'; end if;
  if not exists (select 1 from public.departments where code = 'LSENGG') then raise exception 'Department not added from an issue'; end if;
end $$;

-- A manager cannot invent a tracker or manage the lists.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.mgr_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.mgr_id'), 'role', 'authenticated')::text, true);
do $$ begin
  if not exists (select 1 from public.list_trackers() t where t = 'LS Tracker') then raise exception 'list_trackers misses LS Tracker'; end if;
  begin
    perform public.rename_tracker('LS Tracker', 'Hacked');
    raise exception 'Manager must not rename trackers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.merge_department('LSENGG', 'LSPE');
    raise exception 'Manager must not merge departments';
  exception when insufficient_privilege then null;
  end;
  update public.trackers set active = false where name = 'LS Tracker';
  delete from public.departments where code = 'LSPE';
  if not exists (select 1 from public.trackers where name = 'LS Tracker' and active) then raise exception 'Manager changed the tracker list'; end if;
  if not exists (select 1 from public.departments where code = 'LSPE') then raise exception 'Manager changed the department list'; end if;
end $$;

-- The admin renames a tracker (issues and the manager follow), merges one into it, and merges departments.
select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);
do $$ declare n integer; begin
  n := public.rename_tracker('LS Tracker', 'LS Renamed');
  if n <> 2 then raise exception 'Rename should move 2 issues, moved %', n; end if;
  if (select manager_name from public.profiles where id = current_setting('test.mgr_id')::uuid) <> 'LS Renamed' then raise exception 'Manager profile did not follow'; end if;
  if (select count(*) from public.tasks where manager = 'LS Renamed') <> 2 then raise exception 'Issues did not follow'; end if;
  n := public.rename_tracker('LS Old', 'LS Renamed');
  if n <> 1 or exists (select 1 from public.trackers where name = 'LS Old') then raise exception 'Merge failed'; end if;
  if not exists (select 1 from public.task_events where task_id = 'LS-3' and action = 'update' and detail ? 'manager') then raise exception 'Merge missing from History'; end if;

  n := public.merge_department('LSENGG', 'LSPE');
  if n <> 2 or exists (select 1 from public.departments where code = 'LSENGG') then raise exception 'Department merge failed (%)', n; end if;
  if (select count(*) from public.tasks where dept = 'LSPE' and program = 'Lists Test') <> 3 then raise exception 'Issues not merged'; end if;

  update public.trackers set active = false where name = 'LS Renamed';
  if exists (select 1 from public.list_trackers() t where t = 'LS Renamed') then raise exception 'Hidden tracker still offered'; end if;
end $$;

-- A manager filing under a tracker that does not exist is refused.
select set_config('request.jwt.claim.sub', current_setting('test.mgr_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.mgr_id'), 'role', 'authenticated')::text, true);
do $$ begin
  begin
    insert into public.tasks (manager, program, description, owner) values ('Phantom Tracker', 'Lists Test', 'x', 'Ona Pell');
    raise exception 'Phantom tracker must be refused';
  exception when foreign_key_violation or insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
