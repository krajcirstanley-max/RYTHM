-- RYTHM push delivery cron: invoke the rythm-push edge function every 5 minutes.
-- Without this, background notifications never fire. Idempotent / safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('rythm-push-every-5min')
where exists (select 1 from cron.job where jobname = 'rythm-push-every-5min');

select cron.schedule(
  'rythm-push-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://lqaeggkwhlqclkqhljlk.supabase.co/functions/v1/rythm-push',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
