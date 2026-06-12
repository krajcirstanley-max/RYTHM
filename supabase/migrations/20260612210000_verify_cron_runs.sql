DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN select status, start_time, return_message from cron.job_run_details
           where jobid = (select jobid from cron.job where jobname='rythm-push-every-5min')
           order by start_time desc limit 5 LOOP
    RAISE NOTICE 'RUN % | % | %', r.start_time, r.status, left(coalesce(r.return_message,''),60);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE NOTICE 'NO CRON RUNS RECORDED YET'; END IF;
END $$;
