-- Verification only (no-op): log the scheduled job so it appears in db push output.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN select jobid, schedule, jobname, active from cron.job where jobname = 'rythm-push-every-5min' LOOP
    RAISE NOTICE 'CRON OK -> id=% name=% schedule=% active=%', r.jobid, r.jobname, r.schedule, r.active;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE NOTICE 'CRON MISSING: rythm-push-every-5min not found'; END IF;
END $$;
