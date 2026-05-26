-- Push notification schedule storage
-- The app uploads its computed schedule here; the cron-triggered push function reads it.
CREATE TABLE IF NOT EXISTS push_schedules (
  id TEXT PRIMARY KEY,                -- e.g. "rythm-<device-key>"
  schedule JSONB NOT NULL DEFAULT '[]',  -- array of { type, hour, title, body }
  timezone TEXT DEFAULT 'Europe/Prague',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Allow anon to read/write their own schedule
ALTER TABLE push_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_push_schedules" ON push_schedules
  FOR ALL USING (true) WITH CHECK (true);
