-- Run after migration 0018_comments.sql. Comments follow issue visibility, carry the author's real
-- name, land in the audit trail, and cannot be edited or deleted. All fixtures are rolled back.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.other_id', gen_random_uuid()::text, true);

insert into public.tasks (id, manager, program, description, owner, due_date) values
  ('CM-1', 'CM Manager', 'Comment Test', 'owned by Pellam', 'Pellam Ostrova', current_date + 3),
  ('CM-2', 'CM Manager', 'Comment Test', 'someone else',    'Quillon Brask', current_date + 3);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'cm-owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Pellam Ostrova"}', now(), now()),
  (current_setting('test.other_id')::uuid, 'authenticated', 'authenticated', 'cm-other-' || replace(current_setting('test.other_id'), '-', '') || '@bremboindia.com', '', now(), '{}', '{"name":"Quillon Brask"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);

do $$
declare v record;
begin
  insert into public.task_comments (task_id, body, mentions, author_name)
  values ('CM-1', '  Waiting on the supplier, @Quillon Brask please check  ', array['Quillon Brask', 'Quillon Brask', ' '], 'Faked Name');
  select * into v from public.task_comments where task_id = 'CM-1';
  if v.author_name <> 'Pellam Ostrova' then raise exception 'Author name must come from the profile, got %', v.author_name; end if;
  if v.body <> 'Waiting on the supplier, @Quillon Brask please check' then raise exception 'Body not trimmed: %', v.body; end if;
  if v.mentions <> array['Quillon Brask'] then raise exception 'Mentions not cleaned: %', v.mentions; end if;

  if not exists (select 1 from public.task_events where task_id = 'CM-1' and action = 'comment'
                 and detail ->> 'text' = v.body and detail -> 'mentions' = '["Quillon Brask"]'::jsonb) then
    raise exception 'Comment missing from the audit trail';
  end if;

  begin
    insert into public.task_comments (task_id, body) values ('CM-2', 'not my issue');
    raise exception 'Owner must not comment on an issue they cannot see';
  exception when insufficient_privilege then null;
  end;
  insert into public.task_comments (task_id, body, author) values ('CM-1', 'as someone else', current_setting('test.other_id')::uuid);
  if (select author from public.task_comments where body = 'as someone else') <> current_setting('test.owner_id')::uuid then
    raise exception 'A comment must always be posted as the signed-in person';
  end if;
  begin
    insert into public.task_comments (task_id, body) values ('CM-1', '   ');
    raise exception 'Empty comment must be refused';
  exception when check_violation then null;
  end;

  update public.task_comments set body = 'rewritten' where task_id = 'CM-1';
  delete from public.task_comments where task_id = 'CM-1';
  if (select count(*) from public.task_comments where task_id = 'CM-1' and body <> 'rewritten') <> 2 then raise exception 'Comment was changed or deleted'; end if;
end $$;

-- The other person cannot see CM-1, so cannot see its comments either.
select set_config('request.jwt.claim.sub', current_setting('test.other_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.other_id'), 'role', 'authenticated')::text, true);
do $$ begin
  if exists (select 1 from public.task_comments where task_id = 'CM-1') then raise exception 'Comment visible without the issue'; end if;
  insert into public.task_comments (task_id, body) values ('CM-2', 'on my own issue');
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select count(*) from public.task_comments where task_id like 'CM-%') <> 3 then raise exception 'Expected 3 comments'; end if;
end $$;
rollback;
