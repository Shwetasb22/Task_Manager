-- Run after migration 0020_import_tasks.sql. A sheet is saved completely or not at all, with the
-- normal permission rules and History entries. All fixtures are rolled back.
begin;

select set_config('test.mgr_id', gen_random_uuid()::text, true);
insert into public.tasks (id, manager, program, description, owner, due_date) values
  ('IT-1', 'IT Manager', 'Import Test', 'existing issue', 'Wendel Orsk', current_date + 5),
  ('IT-9', 'Other Manager', 'Import Test', 'someone else''s tracker', 'Wendel Orsk', current_date + 5);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.mgr_id')::uuid, 'authenticated', 'authenticated', 'it-mgr-' || replace(current_setting('test.mgr_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"IT Manager"}', now(), now());
update public.profiles set role = 'manager', owner_name = null, manager_name = 'IT Manager' where id = current_setting('test.mgr_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.mgr_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.mgr_id'), 'role', 'authenticated')::text, true);

do $$
declare r jsonb; v_msg text;
begin
  r := public.import_tasks('IT Manager',
    '[{"row":3,"program":"Import Test","desc":"new one","dept":"PE","owner":"Wendel Orsk","due":"2026-12-01"},
      {"row":4,"program":"Import Test","desc":"new two","dept":"QA","owner":"Ilsa Varn","start":"2026-10-01"}]',
    '[{"row":2,"id":"IT-1","patch":{"due":"2026-11-30","remark":"from Excel"}}]');
  if r <> '{"added": 2, "updated": 1}'::jsonb then raise exception 'Unexpected result %', r; end if;
  if (select count(*) from public.tasks where manager = 'IT Manager') <> 3 then raise exception 'Adds not saved'; end if;
  if (select due_date from public.tasks where id = 'IT-1') <> date '2026-11-30' then raise exception 'Update not saved'; end if;
  if (select member from public.tasks where description = 'new two') <> 'Ilsa Varn' then raise exception 'Member should default to the owner'; end if;
  if not exists (select 1 from public.task_events where task_id = 'IT-1' and action = 'update' and detail ? 'remark') then
    raise exception 'Update missing from the History';
  end if;

  -- One bad row (an issue in another tracker) refuses the whole sheet.
  begin
    perform public.import_tasks('IT Manager',
      '[{"row":5,"program":"Import Test","desc":"must not stay","owner":"Wendel Orsk"}]',
      '[{"row":6,"id":"IT-1","patch":{"remark":"must not stay"}},{"row":7,"id":"IT-9","patch":{"remark":"not mine"}}]');
    raise exception 'Import with a forbidden row must fail';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Excel row 7 (IT-9)%' then raise exception 'Error should name the row, got: %', v_msg; end if;
  end;
  if exists (select 1 from public.tasks where description = 'must not stay' or remark = 'must not stay') then
    raise exception 'A failed import left rows behind';
  end if;

  -- An issue changed after the preview stops the import.
  begin
    perform public.import_tasks('IT Manager', '[]', '[{"row":10,"id":"IT-1","seen":"2001-01-01T00:00:00+00:00","patch":{"remark":"stale"}}]');
    raise exception 'Stale preview must fail';
  exception when serialization_failure then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Excel row 10 (IT-1): someone changed this issue%' then raise exception 'Unexpected: %', v_msg; end if;
  end;
  r := public.import_tasks('IT Manager', '[]', jsonb_build_array(jsonb_build_object('row', 11, 'id', 'IT-1',
         'seen', (select updated_at from public.tasks where id = 'IT-1'), 'patch', '{"remark":"fresh"}'::jsonb)));
  if (select remark from public.tasks where id = 'IT-1') <> 'fresh' then raise exception 'Up-to-date preview should save'; end if;

  -- A bad row in the adds names its row too.
  begin
    perform public.import_tasks('IT Manager', '[{"row":8,"program":"Import Test","desc":"bad dates","owner":"X","start":"2026-10-10","due":"2026-10-01"}]', '[]');
    raise exception 'Bad dates must fail';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Excel row 8:%' then raise exception 'Error should name the row, got: %', v_msg; end if;
  end;

  -- Adding to another tracker is refused like a normal add.
  begin
    perform public.import_tasks('Other Manager', '[{"row":9,"program":"Import Test","desc":"wrong tracker","owner":"X"}]', '[]');
    raise exception 'Import into another tracker must fail';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  begin
    perform public.import_tasks('IT Manager', '[]', '[]');
    raise exception 'Must refuse without a signed-in user';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
