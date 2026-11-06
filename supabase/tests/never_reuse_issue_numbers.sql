-- Run after migration 0024_never_reuse_issue_numbers.sql against a Supabase database.
-- Deleting the newest issue must not give its number to the next new issue. All fixtures are rolled back.
begin;

select set_config('test.manager_name', 'Reuse Check ' || gen_random_uuid()::text, true);

-- Explicit numbers (as the Excel import or SQL Editor would save them) move the counter up.
insert into public.tasks (id, manager, program, description, owner)
values ('QZ-4', current_setting('test.manager_name'), 'Reuse Test', 'Fixture', 'Nobody'),
       ('QZ-9', current_setting('test.manager_name'), 'Reuse Test', 'Fixture', 'Nobody');

do $$
declare v text;
begin
  insert into public.tasks (manager, program, description, owner)
  values (current_setting('test.manager_name'), 'Reuse Test', 'New one', 'Nobody') returning id into v;
  if v <> 'QZ-10' then raise exception 'expected QZ-10, got %', v; end if;

  -- Delete the newest: the next issue must still be QZ-11, not QZ-10 again.
  delete from public.tasks where id = 'QZ-10';
  insert into public.tasks (manager, program, description, owner)
  values (current_setting('test.manager_name'), 'Reuse Test', 'After delete', 'Nobody') returning id into v;
  if v <> 'QZ-11' then raise exception 'number reused: expected QZ-11, got %', v; end if;

  -- Delete everything of the tracker except QZ-4: still no reuse.
  delete from public.tasks where id in ('QZ-9', 'QZ-11');
  if public.next_task_id(current_setting('test.manager_name')) <> 'QZ-12' then
    raise exception 'number reused after deleting several issues';
  end if;

  -- A number imported above the counter moves it up.
  insert into public.tasks (id, manager, program, description, owner)
  values ('QZ-50', current_setting('test.manager_name'), 'Reuse Test', 'Imported', 'Nobody');
  if public.next_task_id(current_setting('test.manager_name')) <> 'QZ-51' then
    raise exception 'imported number did not move the counter';
  end if;

  raise notice 'never_reuse_issue_numbers: all checks passed';
end $$;

-- The counter table is not visible to signed-in users (no grant, and row level security with no policy).
set local role authenticated;
do $$
declare n integer;
begin
  begin
    select count(*) into n from public.task_id_counters;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'signed-in users can read task_id_counters'; end if;
end $$;
reset role;

rollback;
