-- ============================================================================
-- RYTHM push delivery cron
-- ----------------------------------------------------------------------------
-- The rythm-push edge function sends each subscriber the notifications scheduled
-- for the current 5-minute window. It only does anything when something invokes
-- it, so this cron calls it every 5 minutes. WITHOUT this, background push
-- notifications never fire (the local in-app timer only runs while RYTHM is open,
-- which iOS suspends in the background). This is the missing piece that made
-- notifications "not work".
--
-- Run this ONCE in the Supabase SQL editor (project: lqaeggkwhlqclkqhljlk).
-- The rythm-push function is already deployed and reads its own service-role key,
-- so the cron just needs to ping it - no secret to paste.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running is safe: drop the old job first so we don't stack duplicates.
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

-- ----------------------------------------------------------------------------
-- Verify / inspect:
--   select * from cron.job where jobname = 'rythm-push-every-5min';
--   select status, start_time, return_message
--     from cron.job_run_details order by start_time desc limit 10;
-- Remove:
--   select cron.unschedule('rythm-push-every-5min');
-- ----------------------------------------------------------------------------
