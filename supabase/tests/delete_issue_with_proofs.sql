-- Run after migration 0023. An issue with proofs can be deleted; removing a proof from a live issue
-- is still recorded in its History. All fixtures are rolled back.
begin;
insert into public.tasks (id, manager, program, description, owner) values
  ('DP-1', 'DP Manager', 'Delete Test', 'issue with a proof', 'Wendel Orsk'),
  ('DP-2', 'DP Manager', 'Delete Test', 'issue keeping its History', 'Wendel Orsk');
insert into public.proofs (task_id, path, filename, mime, size) values
  ('DP-1', 'DP-1/a.pdf', 'a.pdf', 'application/pdf', 10),
  ('DP-2', 'DP-2/b.pdf', 'b.pdf', 'application/pdf', 10);

do $$ begin
  delete from public.tasks where id = 'DP-1';
  if exists (select 1 from public.proofs where task_id = 'DP-1') then raise exception 'Proof record left behind'; end if;

  delete from public.proofs where task_id = 'DP-2';
  if not exists (select 1 from public.task_events where task_id = 'DP-2' and action = 'proof_removed') then
    raise exception 'Removing a proof from a live issue must still be in its History';
  end if;
end $$;
rollback;
