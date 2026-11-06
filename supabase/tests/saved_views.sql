-- Run after migration 0017_saved_views.sql. People see and change only their own saved views.
begin;
select set_config('test.a', gen_random_uuid()::text, true);
select set_config('test.b', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.a')::uuid, 'authenticated', 'authenticated', 'sv-a-' || replace(current_setting('test.a'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Saved View A"}', now(), now()),
  (current_setting('test.b')::uuid, 'authenticated', 'authenticated', 'sv-b-' || replace(current_setting('test.b'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Saved View B"}', now(), now());
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.a'), 'role', 'authenticated')::text, true);
insert into public.saved_views (name, filters) values ('KTM overdue', '{"q":"KTM","quick":"overdue"}');
do $$ begin
  begin
    insert into public.saved_views (name) values ('ktm overdue ');
    raise exception 'Duplicate view name must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into public.saved_views (user_id, name) values (current_setting('test.b')::uuid, 'Planted');
    raise exception 'Must not create a view for someone else';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.b'), 'role', 'authenticated')::text, true);
do $$ begin
  if exists (select 1 from public.saved_views) then raise exception 'B must not see A''s views'; end if;
  delete from public.saved_views;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select count(*) from public.saved_views where user_id = current_setting('test.a')::uuid) <> 1 then raise exception 'B deleted A''s view'; end if;
end $$;
rollback;
