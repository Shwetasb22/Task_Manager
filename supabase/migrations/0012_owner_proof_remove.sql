-- Owners may remove proof files they uploaded themselves while the issue is still open.
-- Managers/admins keep their existing rights. Removal stays in the audit trail (proofs_log).
begin;

drop policy if exists proofs_delete on public.proofs;
create policy proofs_delete on public.proofs for delete to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_id)
    and (
      public.app_role() in ('admin', 'manager')
      or (
        public.app_role() = 'owner'
        and uploaded_by = auth.uid()
        and exists (
          select 1 from public.tasks t
          where t.id = task_id and t.closed_date is null
        )
      )
    )
  );

-- The file is removed before its metadata row, so the owner's own metadata row authorises it.
drop policy if exists proofs_obj_delete_owner_proof on storage.objects;
create policy proofs_obj_delete_owner_proof on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and public.app_role() = 'owner'
    and exists (
      select 1
      from public.proofs as p
      join public.tasks as t on t.id = p.task_id
      where p.path = storage.objects.name
        and p.uploaded_by = auth.uid()
        and t.closed_date is null
    )
  );

commit;
