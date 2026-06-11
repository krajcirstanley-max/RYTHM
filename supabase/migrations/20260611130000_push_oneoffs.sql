-- One-off push notifications (e.g. a live-activity timer completing while the app
-- is backgrounded/closed). The rythm-push cron sends any rows whose fire_at has
-- passed and marks them sent.
create table if not exists push_oneoffs (
  id bigint generated always as identity primary key,
  sub_key text not null,           -- matches push_subscriptions.id ("rythm-<device>")
  fire_at timestamptz not null,
  title text not null,
  body text,
  tag text,
  sent boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists push_oneoffs_due on push_oneoffs (fire_at) where sent = false;

alter table push_oneoffs enable row level security;
drop policy if exists "anon_push_oneoffs" on push_oneoffs;
create policy "anon_push_oneoffs" on push_oneoffs for all using (true) with check (true);
