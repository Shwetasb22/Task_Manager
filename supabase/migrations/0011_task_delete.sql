-- Managers may permanently remove issues from their own tracker; admins may remove
-- issues from any tracker. Owners never receive task-delete permission.
begin;

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
       public.app_role() = 'admin'
    or (public.app_role() = 'manager' and manager = public.app_manager())
  );

commit;

