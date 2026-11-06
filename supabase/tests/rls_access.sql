-- Run after migrations 0001-0005 against a Supabase database.
-- Verifies tracker isolation and proof metadata insert scope; fixtures are rolled back.
begin;

select set_config('test.manager_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'RLS Test ' || gen_random_uuid()::text, true);
select set_config('test.manager_name', 'RLS Test Manager', true);
select set_config('test.visible_task_id', 'rls-visible-' || gen_random_uuid()::text, true);
select set_config('test.foreign_task_id', 'rls-foreign-' || gen_random_uuid()::text, true);

insert into public.tasks (id, manager, program, description, owner)
values
  (current_setting('test.visible_task_id'), current_setting('test.manager_name'), 'Security Test', 'Visible task', current_setting('test.owner_name')),
  (current_setting('test.foreign_task_id'), 'Different Test Manager', 'Security Test', 'Foreign task', current_setting('test.owner_name'));

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  current_setting('test.manager_id')::uuid,
  'authenticated',
  'authenticated',
  'rls-manager-' || replace(current_setting('test.manager_id'), '-', '') || '@bremboindia.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', current_setting('test.owner_name')),
  now(),
  now()
);

update public.profiles
set role = 'manager', manager_name = current_setting('test.manager_name')
where id = current_setting('test.manager_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.manager_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.manager_id'), 'role', 'authenticated')::text, true);

do $$
declare
  visible_count integer;
  affected integer;
begin
  select count(*) into visible_count
  from public.tasks
  where id = current_setting('test.foreign_task_id');
  if visible_count <> 0 then raise exception 'Manager can see another manager tracker task'; end if;

  update public.tasks
  set remark = 'Unauthorized change'
  where id = current_setting('test.foreign_task_id');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Manager changed another manager tracker task'; end if;

  begin
    insert into public.proofs (task_id, path, filename, mime, size, uploaded_by)
    values (
      current_setting('test.foreign_task_id'),
      current_setting('test.foreign_task_id') || '/forbidden.pdf',
      'forbidden.pdf', 'application/pdf', 1, auth.uid()
    );
    raise exception 'Proof metadata insert for an inaccessible task should be denied';
  exception
    when insufficient_privilege then null;
  end;

  insert into public.proofs (task_id, path, filename, mime, size, uploaded_by)
  values (
    current_setting('test.visible_task_id'),
    current_setting('test.visible_task_id') || '/allowed.pdf',
    'allowed.pdf', 'application/pdf', 1, auth.uid()
  );
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Proof metadata insert for visible task did not succeed'; end if;
end;
$$;

reset role;
rollback;
