-- Run after all migrations against a Supabase database.
-- The transaction rolls back the task and Auth user fixtures after assertions.
begin;

do $$
declare
  test_user_id uuid := gen_random_uuid();
  test_owner_name text := 'Signup Role Verification ' || gen_random_uuid()::text;
  test_task_id text := 'signup-role-' || gen_random_uuid()::text;
  test_email text;
  actual_role text;
  actual_owner_name text;
  actual_manager_name text;
begin
  test_email := 'signup-role-' || replace(test_user_id::text, '-', '') || '@bremboindia.com';

  insert into public.tasks (id, manager, program, description, owner)
  values (test_task_id, 'Signup Role Test Manager', 'Security Test', 'Temporary signup test task', test_owner_name);

  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    test_user_id,
    'authenticated',
    'authenticated',
    test_email,
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'name', test_owner_name,
      'role', 'admin',
      'owner_name', 'Forged Owner',
      'manager_name', 'Forged Manager'
    ),
    now(),
    now()
  );

  select role, owner_name, manager_name
    into actual_role, actual_owner_name, actual_manager_name
    from public.profiles
    where id = test_user_id;

  if actual_role is distinct from 'owner' then
    raise exception 'Expected owner role despite admin signup metadata; got %', actual_role;
  end if;
  if actual_owner_name is distinct from test_owner_name then
    raise exception 'Expected tracker-matched owner name; got %', actual_owner_name;
  end if;
  if actual_manager_name is not null then
    raise exception 'Expected manager_name to be null; got %', actual_manager_name;
  end if;
end;
$$;

rollback;