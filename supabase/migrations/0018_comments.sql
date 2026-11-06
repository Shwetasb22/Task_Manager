-- Comments on an issue, with @mentions. Anyone who can see an issue can read and add its comments.
-- Each comment is also written to the audit trail (task_events, action 'comment'), so it shows in the
-- issue History and in the notification bell of the people it mentions. Comments are kept like the
-- rest of the history: nobody can edit or delete them from the app.
-- Apply after 0017. Safe to re-run.

begin;

create table if not exists public.task_comments (
  id          bigint generated always as identity primary key,
  task_id     text not null references public.tasks(id) on delete cascade on update cascade,
  author      uuid default auth.uid() references auth.users(id) on delete set null,
  author_name text,
  body        text not null check (btrim(body) <> '' and length(body) <= 2000),
  mentions    text[] not null default '{}' check (cardinality(mentions) <= 20),
  created_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));   -- same visibility as the issue

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id));
-- no update or delete policies: comments are part of the audit trail.

-- The author's name always comes from their profile, never from the browser.
create or replace function public.task_comments_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := auth.uid();
  new.author_name := coalesce(public.app_name(), new.author_name);
  new.body := btrim(new.body);
  new.mentions := coalesce((select array_agg(distinct btrim(m)) from unnest(new.mentions) m where btrim(m) <> ''), '{}');
  new.created_at := now();
  return new;
end $$;
drop trigger if exists task_comments_fill_trg on public.task_comments;
create trigger task_comments_fill_trg before insert on public.task_comments
  for each row execute function public.task_comments_fill();

create or replace function public.task_comments_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_events (task_id, actor, actor_name, action, detail, at)
  values (new.task_id, new.author, new.author_name, 'comment',
          jsonb_build_object('comment_id', new.id, 'text', new.body, 'mentions', to_jsonb(new.mentions)), new.created_at);
  return null;
end $$;
drop trigger if exists task_comments_log_trg on public.task_comments;
create trigger task_comments_log_trg after insert on public.task_comments
  for each row execute function public.task_comments_log();

grant select, insert on public.task_comments to authenticated;

-- Live: a new comment refreshes the bell and an open History window for everyone who can see the issue.
do $$ begin alter publication supabase_realtime add table public.task_comments;
exception when duplicate_object then null; when undefined_object then null; end $$;

commit;
