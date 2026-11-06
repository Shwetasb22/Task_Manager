-- Run after migration 0022_archive.sql. Old closed issues are archived by an admin or the server only,
-- without History noise, and a reopened issue comes back. All fixtures are rolled back.
begin;

select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.mgr_id', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.admin_id')::uuid, 'authenticated', 'authenticated', 'ar-admin-' || replace(current_setting('test.admin_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"AR Admin"}', now(), now()),
  (current_setting('test.mgr_id')::uuid, 'authenticated', 'authenticated', 'ar-mgr-' || replace(current_setting('test.mgr_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"AR Manager"}', now(), now());
update public.profiles set role = 'admin', owner_name = null where id = current_setting('test.admin_id')::uuid;
update public.profiles set role = 'manager', owner_name = null, manager_name = 'AR Tracker' where id = current_setting('test.mgr_id')::uuid;

insert into public.tasks (id, manager, program, description, owner, start_date, due_date) values
  ('AR-1', 'AR Tracker', 'Archive Test', 'closed two years ago', 'Olek Brand', current_date - 800, current_date - 760),
  ('AR-2', 'AR Tracker', 'Archive Test', 'closed last month',    'Olek Brand', current_date - 60, current_date - 40),
  ('AR-3', 'AR Tracker', 'Archive Test', 'still open',           'Olek Brand', current_date - 800, current_date - 760);
update public.tasks set closed_date = current_date - 750 where id = 'AR-1';
update public.tasks set closed_date = current_date - 30 where id = 'AR-2';
select set_config('test.events', (select count(*)::text from public.task_events where task_id like 'AR-%'), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.mgr_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.mgr_id'), 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.archive_closed_tasks(365);
    raise exception 'Manager must not archive';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated')::text, true);
do $$ declare n integer; begin
  if public.archive_candidates(365) < 1 then raise exception 'AR-1 should be a candidate'; end if;
  begin
    perform public.archive_closed_tasks(30);
    raise exception 'Too short a period must be refused';
  exception when invalid_parameter_value then null;
  end;
  n := public.archive_closed_tasks(365);
  if n < 1 then raise exception 'Nothing archived'; end if;
  if (select archived_at from public.tasks where id = 'AR-1') is null then raise exception 'AR-1 not archived'; end if;
  if exists (select 1 from public.tasks where id in ('AR-2', 'AR-3') and archived_at is not null) then raise exception 'Archived too much'; end if;
  if (select count(*) from public.task_events where task_id like 'AR-%') <> current_setting('test.events')::integer then
    raise exception 'Archiving must not add History entries';
  end if;
end $$;

-- The manager can still see the archived issue, and reopening it brings it back.
select set_config('request.jwt.claim.sub', current_setting('test.mgr_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.mgr_id'), 'role', 'authenticated')::text, true);
do $$ begin
  if not exists (select 1 from public.tasks where id = 'AR-1') then raise exception 'Archived issue hidden from its manager'; end if;
  update public.tasks set closed_date = null where id = 'AR-1';
  if not found then raise exception 'Manager could not reopen the archived issue'; end if;
  if (select archived_at from public.tasks where id = 'AR-1') is not null then raise exception 'Reopened issue still archived'; end if;
  if not exists (select 1 from public.task_events where task_id = 'AR-1' and detail ? 'closed_date' and not (detail ? 'archived_at')) then
    raise exception 'Reopen should be in the History, without archived_at';
  end if;
end $$;
reset role;
rollback;
