-- Run after migration 0016_daily_alerts.sql. A person switches only their own morning email.
begin;
select set_config('test.a', gen_random_uuid()::text, true);
select set_config('test.b', gen_random_uuid()::text, true);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.a')::uuid, 'authenticated', 'authenticated', 'da-a-' || replace(current_setting('test.a'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Daily Alert A"}', now(), now()),
  (current_setting('test.b')::uuid, 'authenticated', 'authenticated', 'da-b-' || replace(current_setting('test.b'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Daily Alert B"}', now(), now());
do $$ begin
  if (select notify_daily from public.profiles where id = current_setting('test.a')::uuid) is not true then raise exception 'Morning email should start switched on'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.a'), 'role', 'authenticated')::text, true);
select public.set_daily_email(false);
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
  exception when others then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select notify_daily from public.profiles where id = current_setting('test.a')::uuid) is not false then raise exception 'A could not switch the email off'; end if;
  if (select notify_daily from public.profiles where id = current_setting('test.b')::uuid) is not true then raise exception 'B must not change'; end if;
  if (select role from public.profiles where id = current_setting('test.a')::uuid) <> 'owner' then raise exception 'Profile role must stay read-only'; end if;
end $$;
rollback;
