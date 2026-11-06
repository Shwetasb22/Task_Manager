-- Excel import in one step: every new and changed row of a tracker sheet is saved in a single request
-- and a single transaction. Either the whole sheet is saved or nothing is, so a failed import never
-- leaves a tracker half updated. The function runs as the signed-in person (security invoker), so
-- the usual row level security, role checks and History logging all apply row by row.
-- Each update carries the issue's updated_at as seen in the preview ("seen"); if the issue changed
-- since then, the whole import stops instead of overwriting someone else's newer change.
-- Apply after 0019. Safe to re-run. Older apps keep working: they save row by row as before.

begin;

create or replace function public.import_tasks(p_manager text, p_adds jsonb, p_updates jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  a jsonb;
  u jsonb;
  p jsonb;
  v_label text;
  v_n integer;
  v_added integer := 0;
  v_updated integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to import.';
  end if;
  p_adds := coalesce(p_adds, '[]'::jsonb);
  p_updates := coalesce(p_updates, '[]'::jsonb);
  if jsonb_typeof(p_adds) <> 'array' or jsonb_typeof(p_updates) <> 'array' then
    raise exception using errcode = '22023', message = 'The import is not in the expected format.';
  end if;
  if jsonb_array_length(p_adds) + jsonb_array_length(p_updates) > 5000 then
    raise exception using errcode = '22023', message = 'At most 5000 rows can be imported at once. Split the sheet.';
  end if;

  -- Updates first: a new issue can never take the ID of an issue deleted meanwhile and then be updated by mistake.
  for u in select value from jsonb_array_elements(p_updates) loop
    v_label := 'Excel row ' || coalesce(u ->> 'row', '?') || ' (' || coalesce(u ->> 'id', '?') || ')';
    p := coalesce(u -> 'patch', '{}'::jsonb);
    begin
      update public.tasks t set
        program     = case when p ? 'program'  then p ->> 'program' else t.program end,
        description = case when p ? 'desc'     then p ->> 'desc' else t.description end,
        dept        = case when p ? 'dept'     then p ->> 'dept' else t.dept end,
        customer    = case when p ? 'customer' then p ->> 'customer' else t.customer end,
        owner       = case when p ? 'owner'    then p ->> 'owner' else t.owner end,
        member      = case when p ? 'member'   then p ->> 'member' else t.member end,
        start_date  = case when p ? 'start'    then nullif(p ->> 'start', '')::date else t.start_date end,
        due_date    = case when p ? 'due'      then nullif(p ->> 'due', '')::date else t.due_date end,
        next_date   = case when p ? 'next'     then nullif(p ->> 'next', '')::date else t.next_date end,
        remark      = case when p ? 'remark'   then nullif(p ->> 'remark', '') else t.remark end
      where t.id = u ->> 'id'
        and (not (u ? 'seen') or t.updated_at = (u ->> 'seen')::timestamptz);
      get diagnostics v_n = row_count;
    exception when others then
      raise exception using errcode = sqlstate, message = v_label || ': ' || sqlerrm;
    end;
    if v_n = 0 and u ? 'seen' and exists (select 1 from public.tasks t where t.id = u ->> 'id') then
      raise exception using errcode = '40001',
        message = v_label || ': someone changed this issue after you opened the preview. Open the import again to see the latest values.';
    end if;
    if v_n = 0 then
      raise exception using errcode = '42501',
        message = v_label || ': this issue was not saved. It may have been deleted, or you are not allowed to change it (an owner''s issue must stay assigned to them).';
    end if;
    v_updated := v_updated + 1;
  end loop;

  for a in select value from jsonb_array_elements(p_adds) loop
    v_label := 'Excel row ' || coalesce(a ->> 'row', '?');
    begin
      insert into public.tasks (manager, program, description, dept, customer, owner, member, start_date, due_date, next_date, remark)
      values (p_manager, a ->> 'program', a ->> 'desc', a ->> 'dept', coalesce(a ->> 'customer', ''), a ->> 'owner',
              coalesce(nullif(a ->> 'member', ''), a ->> 'owner'),
              nullif(a ->> 'start', '')::date, nullif(a ->> 'due', '')::date, nullif(a ->> 'next', '')::date,
              nullif(a ->> 'remark', ''));
    exception when others then
      raise exception using errcode = sqlstate, message = v_label || ': ' || sqlerrm;
    end;
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

revoke all on function public.import_tasks(text, jsonb, jsonb) from public, anon;
grant execute on function public.import_tasks(text, jsonb, jsonb) to authenticated;

commit;
