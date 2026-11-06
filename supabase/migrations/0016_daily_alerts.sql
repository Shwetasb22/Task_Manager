-- Daily email alerts: each person can switch their morning email off or on.
-- The email itself is sent by scripts/daily-digest.mjs on the app server (see docs/DAILY_ALERTS.md).
-- Apply after 0015. Safe to re-run.

begin;

alter table public.profiles add column if not exists notify_daily boolean not null default true;

-- People cannot edit their own profile row (roles live there), so this one setting has its own function.
create or replace function public.set_daily_email(p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in first.';
  end if;
  update public.profiles set notify_daily = coalesce(p_on, true) where id = auth.uid();
  return coalesce(p_on, true);
end;
$$;
revoke all on function public.set_daily_email(boolean) from public, anon;
grant execute on function public.set_daily_email(boolean) to authenticated;

commit;
