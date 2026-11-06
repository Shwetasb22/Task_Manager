-- Run after migrations 0001-0012 against a Supabase database.
-- Owner can delete an orphaned object but not an object with proof metadata on a closed issue.
-- (Owners may remove their own proof while the issue is open; see owner_proof_remove.sql.)
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'Proof Delete Test ' || gen_random_uuid()::text, true);
select set_config('test.manager_name', 'Proof Delete Test Manager', true);
select set_config('test.task_id', 'proof-delete-' || gen_random_uuid()::text, true);
select set_config('test.orphan_path', current_setting('test.task_id') || '/orphan.pdf', true);
select set_config('test.reviewed_path', current_setting('test.task_id') || '/reviewed.pdf', true);

insert into public.tasks (id, manager, program, description, owner, due_date, closed_date)
values (current_setting('test.task_id'), current_setting('test.manager_name'), 'Security Test', 'Proof delete fixture', current_setting('test.owner_name'), current_date, current_date);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  current_setting('test.owner_id')::uuid,
  'authenticated',
  'authenticated',
  'proof-delete-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', current_setting('test.owner_name')),
  now(),
  now()
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('proofs', current_setting('test.orphan_path'), current_setting('test.owner_id'), '{}'::jsonb),
  ('proofs', current_setting('test.reviewed_path'), current_setting('test.owner_id'), '{}'::jsonb);

insert into public.proofs (task_id, path, filename, mime, size, uploaded_by)
values (
  current_setting('test.task_id'),
  current_setting('test.reviewed_path'),
  'reviewed.pdf',
  'application/pdf',
  1,
  current_setting('test.owner_id')::uuid
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);

do $$
declare
  affected integer;
  reviewed_count integer;
begin
  delete from storage.objects
  where bucket_id = 'proofs' and name = current_setting('test.orphan_path');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner could not delete their own orphaned object'; end if;

  delete from storage.objects
  where bucket_id = 'proofs' and name = current_setting('test.reviewed_path');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner deleted an object with proof metadata'; end if;

  select count(*) into reviewed_count
  from storage.objects
  where bucket_id = 'proofs' and name = current_setting('test.reviewed_path');
  if reviewed_count <> 1 then raise exception 'Reviewed proof object should remain stored'; end if;
end;
$$;

reset role;
rollback;
