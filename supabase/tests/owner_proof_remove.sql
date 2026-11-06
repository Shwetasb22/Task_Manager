-- Run after migrations 0001-0012 against a Supabase database.
-- An owner can remove proof they uploaded on an open issue, but not someone else's
-- proof and not proof on a closed issue.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.other_id', gen_random_uuid()::text, true);
select set_config('test.owner_name', 'Owner Remove Test ' || gen_random_uuid()::text, true);
select set_config('test.open_task', 'owner-remove-open-' || gen_random_uuid()::text, true);
select set_config('test.closed_task', 'owner-remove-closed-' || gen_random_uuid()::text, true);
select set_config('test.own_path', current_setting('test.open_task') || '/own.pdf', true);
select set_config('test.other_path', current_setting('test.open_task') || '/other.pdf', true);
select set_config('test.closed_path', current_setting('test.closed_task') || '/closed.pdf', true);

insert into public.tasks (id, manager, program, description, owner, due_date, closed_date) values
  (current_setting('test.open_task'), 'Owner Remove Manager', 'Security Test', 'Open fixture', current_setting('test.owner_name'), current_date + 5, null),
  (current_setting('test.closed_task'), 'Owner Remove Manager', 'Security Test', 'Closed fixture', current_setting('test.owner_name'), current_date, current_date);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated',
   'owner-remove-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now()),
  (current_setting('test.other_id')::uuid, 'authenticated', 'authenticated',
   'owner-remove-' || replace(current_setting('test.other_id'), '-', '') || '@bremboindia.com', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', current_setting('test.owner_name')), now(), now());

-- The second account is a manager, i.e. someone other than this owner.
update public.profiles set role = 'manager', owner_name = null, manager_name = 'Owner Remove Manager'
where id = current_setting('test.other_id')::uuid;

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('proofs', current_setting('test.own_path'), current_setting('test.owner_id'), '{}'::jsonb),
  ('proofs', current_setting('test.other_path'), current_setting('test.other_id'), '{}'::jsonb),
  ('proofs', current_setting('test.closed_path'), current_setting('test.owner_id'), '{}'::jsonb);

insert into public.proofs (task_id, path, filename, mime, size, uploaded_by) values
  (current_setting('test.open_task'), current_setting('test.own_path'), 'own.pdf', 'application/pdf', 1, current_setting('test.owner_id')::uuid),
  (current_setting('test.open_task'), current_setting('test.other_path'), 'other.pdf', 'application/pdf', 1, current_setting('test.other_id')::uuid),
  (current_setting('test.closed_task'), current_setting('test.closed_path'), 'closed.pdf', 'application/pdf', 1, current_setting('test.owner_id')::uuid);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);

do $$
declare affected integer;
begin
  -- Same order as the app: file first, then metadata.
  delete from storage.objects where bucket_id = 'proofs' and name = current_setting('test.own_path');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner could not delete their own proof file on an open issue'; end if;
  delete from public.proofs where path = current_setting('test.own_path');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner could not delete their own proof metadata on an open issue'; end if;

  delete from storage.objects where bucket_id = 'proofs' and name = current_setting('test.other_path');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner deleted a proof file uploaded by someone else'; end if;
  delete from public.proofs where path = current_setting('test.other_path');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner deleted proof metadata uploaded by someone else'; end if;

  delete from storage.objects where bucket_id = 'proofs' and name = current_setting('test.closed_path');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner deleted a proof file on a closed issue'; end if;
  delete from public.proofs where path = current_setting('test.closed_path');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner deleted proof metadata on a closed issue'; end if;
end;
$$;

reset role;
rollback;
