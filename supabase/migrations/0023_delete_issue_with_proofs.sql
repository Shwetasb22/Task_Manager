-- Fix: deleting an issue that has proof files failed with "violates foreign key constraint
-- task_events_task_id_fkey", after the app had already removed the proof files from storage.
-- Cause: removing the issue also removes its proof records, and each removal tried to write a
-- "proof removed" History entry for the issue that was being deleted. The History of a deleted issue
-- goes with it, so that entry is now skipped when the issue itself is gone.
-- Apply after 0022. Safe to re-run.
begin;

create or replace function public.proofs_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor, actor_name, action, detail)
    values (new.task_id, auth.uid(), public.app_name(), 'proof_added',
            jsonb_build_object('filename', new.filename, 'size', new.size));
  elsif exists (select 1 from public.tasks where id = old.task_id) then
    insert into public.task_events (task_id, actor, actor_name, action, detail)
    values (old.task_id, auth.uid(), public.app_name(), 'proof_removed',
            jsonb_build_object('filename', old.filename));
  end if;
  return null;
end $$;

commit;
