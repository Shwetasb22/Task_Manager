-- Limit uploader cleanup to their own proof-bucket objects without metadata.
begin;

drop policy if exists proofs_obj_delete_own_upload on storage.objects;
create policy proofs_obj_delete_own_upload on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and owner_id = auth.uid()::text
    and exists (
      select 1 from public.tasks as t
      where t.id = (storage.foldername(name))[1]
    )
    and not exists (
      select 1 from public.proofs as p
      where p.path = storage.objects.name
    )
  );

commit;
