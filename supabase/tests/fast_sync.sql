-- Run after migration 0019_fast_sync.sql. Adding or removing proof marks its issue as changed (so the
-- app's quick reload picks it up) for owners and managers alike, without a History entry.
-- now() is fixed inside one transaction, so the test watches updated_by, which the same trigger sets.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.mgr_id', gen_random_uuid()::text, true);

insert into public.tasks (id, manager, program, description, owner, due_date) values
  ('FS-1', 'FS Manager', 'Fast Sync Test', 'proof touches the issue', 'Torvald Imre', current_date + 5);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'fs-owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Torvald Imre"}', now(), now()),
  (current_setting('test.mgr_id')::uuid, 'authenticated', 'authenticated', 'fs-mgr-' || replace(current_setting('test.mgr_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"FS Manager"}', now(), now());
update public.profiles set role = 'manager', owner_name = null, manager_name = 'FS Manager' where id = current_setting('test.mgr_id')::uuid;

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('proofs', 'FS-1/a.pdf', current_setting('test.owner_id'), '{}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
insert into public.proofs (task_id, path, filename, mime, size, uploaded_by)
values ('FS-1', 'FS-1/a.pdf', 'a.pdf', 'application/pdf', 1, current_setting('test.owner_id')::uuid);

reset role;
do $$ begin
  if (select updated_by from public.tasks where id = 'FS-1') is distinct from current_setting('test.owner_id')::uuid then
    raise exception 'Owner proof upload did not mark the issue as changed';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.mgr_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.mgr_id'), 'role', 'authenticated')::text, true);
delete from public.proofs where task_id = 'FS-1';

reset role;
do $$ begin
  if (select updated_by from public.tasks where id = 'FS-1') is distinct from current_setting('test.mgr_id')::uuid then
    raise exception 'Manager proof removal did not mark the issue as changed';
  end if;
  if exists (select 1 from public.proofs where task_id = 'FS-1') then raise exception 'Proof not removed'; end if;
  if exists (select 1 from public.task_events where task_id = 'FS-1' and action = 'update') then
    raise exception 'Touching the issue must not add a History entry';
  end if;
  -- A direct SQL edit (no signed-in user) still gets a fresh change time.
  update public.tasks set remark = 'edited in SQL', updated_at = '2000-01-01' where id = 'FS-1';
  if (select updated_at from public.tasks where id = 'FS-1') <> now() then raise exception 'SQL edit did not refresh updated_at'; end if;
end $$;
rollback;
