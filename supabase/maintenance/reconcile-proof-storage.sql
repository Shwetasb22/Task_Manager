-- Read-only reconciliation report. Run with a database role that can read
-- public.proofs and storage.objects; no rows are modified.
with proof_metadata as (
  select id, path
  from public.proofs
), proof_objects as (
  select name as path
  from storage.objects
  where bucket_id = 'proofs'
)
select
  coalesce(p.path, o.path) as object_path,
  p.id as proof_id,
  case
    when p.id is null then 'storage_object_without_metadata'
    when o.path is null then 'metadata_without_storage_object'
  end as issue
from proof_metadata as p
full outer join proof_objects as o on o.path = p.path
where p.id is null or o.path is null
order by object_path;
