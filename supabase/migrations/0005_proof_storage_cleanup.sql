-- Allow uploaders to clean up their own object if proof metadata insertion fails.
-- The existing manager/admin delete policy remains in force for other objects.
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
  );

commit;