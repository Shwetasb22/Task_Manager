-- Give Vishal Shinde the same global admin access as Naveen Sahni.
-- Apply after 0025_assignment_import_roles.sql. Safe to re-run.

begin;

alter table public.profiles
  add column if not exists can_edit_owner_names boolean not null default false;

update public.profiles
set role = 'admin', name = 'Vishal Shinde', can_edit_owner_names = true
where lower(email) = 'vishal.shinde@bremboindia.com'
   or lower(btrim(name)) = 'vishal shinde';

create or replace function public.employees_guard_name()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.name is distinct from old.name and not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (role = 'dept_head' or can_edit_owner_names)
  ) then
    raise exception using errcode = '42501', message = 'Only a dept head can edit an owner name.';
  end if;
  return new;
end;
$$;

create or replace function public.rename_owner(p_from text, p_to text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_count integer;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (role = 'dept_head' or can_edit_owner_names)
  ) then
    raise exception using errcode = '42501', message = 'Only a dept head can rename owners.';
  end if;
  if public.norm_name(p_from) is null or public.norm_name(p_to) is null then
    raise exception using errcode = '22023', message = 'Enter both names.';
  end if;
  update public.tasks
  set owner = public.replace_owner_name(owner, p_from, p_to)
  where public.owner_tokens(owner) @> array[public.norm_name(p_from)]
    and public.replace_owner_name(owner, p_from, p_to) is distinct from owner;
  get diagnostics v_count = row_count;
  update public.employees set name = btrim(p_to) where public.norm_name(name) = public.norm_name(p_from);
  return v_count;
end;
$$;

commit;
