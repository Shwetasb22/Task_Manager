-- Faster loading: the app keeps a copy of the issues in the browser and, on the next visit, downloads
-- only issues whose updated_at changed. Adding or removing proof must therefore also mark its issue
-- as changed. Only updated_at moves: the History does not record it.
-- Every change to an issue gets a fresh updated_at, including edits made directly in SQL or by the
-- server scripts (the role checks in tasks_guard skip those). The trigger name starts with zz_ so it
-- runs after the other BEFORE UPDATE triggers.
-- Apply after 0018. Safe to re-run.

begin;

create or replace function public.tasks_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists zz_tasks_touch_trg on public.tasks;
create trigger zz_tasks_touch_trg before update on public.tasks
  for each row execute function public.tasks_touch();

create index if not exists tasks_updated_at_idx on public.tasks (updated_at);

create or replace function public.proofs_touch_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set updated_at = now() where id = coalesce(new.task_id, old.task_id);
  return null;
end $$;
drop trigger if exists proofs_touch_task_trg on public.proofs;
create trigger proofs_touch_task_trg after insert or delete on public.proofs
  for each row execute function public.proofs_touch_task();

commit;
