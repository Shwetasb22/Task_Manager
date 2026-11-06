begin;

alter table public.tasks add column if not exists customer text not null default '';
create index if not exists tasks_customer_idx on public.tasks (customer) where customer <> '';
create index if not exists tasks_manager_open_due_idx on public.tasks (manager, due_date) where closed_date is null;
create index if not exists tasks_owner_open_due_idx on public.tasks (owner, due_date) where closed_date is null;

update public.tasks
set dept = case upper(trim(dept))
  when 'PM' then 'PRGM'
  when 'PM-BI' then 'PRGM'
  when 'PM_BI' then 'PRGM'
  when 'PM-BREMBO' then 'PRGM'
  when 'PM_BREMBO' then 'PRGM'
  when 'PM-AM' then 'PRGM'
  when 'PM-PUR' then 'PRGM'
  when 'SALES' then 'KAM'
  when 'ENGG' then 'PE'
  when 'PROCESS' then 'PRCE'
  when 'QUALITY' then 'QE'
  when 'PUR' then 'PBYR'
  when 'PUR-INDIRECT' then 'PBYR'
  when 'LOG' then 'LOG'
  when 'FINANCE' then 'CE'
  else dept
end;

commit;