-- Run after migration 0014_owner_access.sql against a Supabase database.
-- An owner sees and edits their issues from every tracker, however the Owner cell spells them.
-- All fixtures are rolled back.
begin;

select set_config('test.owner_id', gen_random_uuid()::text, true);
select set_config('test.other_id', gen_random_uuid()::text, true);

-- Tracker spellings of "Qorvina Zelmarsh" across three managers.
insert into public.tasks (id, manager, program, description, owner, due_date) values
  ('OA-1', 'OA Manager One',   'Owner Access Test', 'exact full name',      'Qorvina Zelmarsh', current_date + 3),
  ('OA-2', 'OA Manager Two',   'Owner Access Test', 'first name only',      'Qorvina', current_date + 3),
  ('OA-3', 'OA Manager Three', 'Owner Access Test', 'surname first',        'Zelmarsh Qorvina', current_date + 3),
  ('OA-4', 'OA Manager One',   'Owner Access Test', 'one of several',       'Brindle Oakes / Qorvina Zelmarsh / Tamsin Vey', current_date + 3),
  ('OA-5', 'OA Manager Two',   'Owner Access Test', 'misspelled surname',   'Qorvina Zelmarch', current_date + 3),
  ('OA-6', 'OA Manager Two',   'Owner Access Test', 'someone else',         'Brindle Oakes', current_date + 3),
  ('OA-7', 'OA Manager Three', 'Owner Access Test', 'closed issue',         'Qorvina Zelmarsh', current_date + 3);
update public.tasks set closed_date = current_date where id = 'OA-7';

-- Signup with a spelling that matches no tracker cell exactly must still succeed.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  (current_setting('test.owner_id')::uuid, 'authenticated', 'authenticated', 'oa-owner-' || replace(current_setting('test.owner_id'), '-', '') || '@bremboindia.com', '', now(), '{}'::jsonb, '{"name":"Qorvina  Zelmarsh"}'::jsonb, now(), now()),
  (current_setting('test.other_id')::uuid, 'authenticated', 'authenticated', 'oa-other-' || replace(current_setting('test.other_id'), '-', '') || '@bremboindia.com', '', now(), '{}'::jsonb, '{"name":"Nobody Matches Here"}'::jsonb, now(), now());

do $$
declare v_role text; v_aliases text[];
begin
  select role, owner_aliases into v_role, v_aliases from public.profiles where id = current_setting('test.other_id')::uuid;
  if v_role is distinct from 'owner' then raise exception 'Unmatched signup should still create an owner profile'; end if;
  select owner_aliases into v_aliases from public.profiles where id = current_setting('test.owner_id')::uuid;
  if not ('qorvina zelmarch' = any (v_aliases)) then raise exception 'Expected fuzzy tracker spelling in aliases, got %', v_aliases; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);

do $$
declare v_ids text;
begin
  select string_agg(id, ',' order by id) into v_ids from public.tasks where program = 'Owner Access Test';
  if v_ids is distinct from 'OA-1,OA-2,OA-3,OA-4,OA-5,OA-7' then
    raise exception 'Owner should see their issues from all trackers, got %', v_ids;
  end if;

  -- Every detail field is editable by the owner.
  update public.tasks set program = 'Owner Access Test', description = 'edited by owner', dept = 'QE',
    customer = 'KTM', start_date = current_date, due_date = current_date + 9, next_date = current_date + 7,
    remark = 'owner remark', member = 'helper'
  where id = 'OA-2';
  if not found then raise exception 'Owner edit of OA-2 did not apply'; end if;

  -- Still assigned to them after adding a colleague as co-owner.
  update public.tasks set owner = 'Qorvina / Tamsin Vey' where id = 'OA-2';

  begin
    update public.tasks set manager = 'OA Manager One' where id = 'OA-2';
    raise exception 'Owner must not move an issue to another tracker';
  exception when others then
    if sqlerrm not like '%Only an admin can move%' then raise; end if;
  end;

  begin
    update public.tasks set closed_date = null where id = 'OA-7';
    raise exception 'Owner must not reopen a closed issue';
  exception when insufficient_privilege then null;
  end;

  -- Reassigning away entirely is refused (they would lose the issue).
  begin
    update public.tasks set owner = 'Brindle Oakes' where id = 'OA-1';
    raise exception 'Owner must not hand an issue to someone else';
  exception when insufficient_privilege then null;
  end;

  -- Cannot touch someone else''s issue.
  update public.tasks set remark = 'not mine' where id = 'OA-6';
  if found then raise exception 'Owner updated an issue that is not theirs'; end if;

  if not exists (select 1 from public.list_trackers() t where t = 'OA Manager Three') then
    raise exception 'list_trackers should return every tracker';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- A manager writes a new spelling later: the owner picks it up automatically.
insert into public.tasks (id, manager, program, description, owner) values
  ('OA-8', 'OA Manager One', 'Owner Access Test', 'new spelling later', 'Qorvina Zelmersh');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner_id'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from public.tasks where id = 'OA-8') then
    raise exception 'Owner should see an issue added later with a close spelling of their name';
  end if;
end $$;

-- The unmatched owner sees nothing yet, without an error.
select set_config('request.jwt.claim.sub', current_setting('test.other_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.other_id'), 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from public.tasks where program = 'Owner Access Test') then
    raise exception 'Unmatched owner should see no fixture issues';
  end if;
end $$;

rollback;
