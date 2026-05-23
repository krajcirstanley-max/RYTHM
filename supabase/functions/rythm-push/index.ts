import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("RYTHM_VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("RYTHM_VAPID_PRIVATE")!;

webpush.setVapidDetails("mailto:rythm@noreply.app", VAPID_PUBLIC, VAPID_PRIVATE);

// Messages rotate based on time of day
const MSGS: Record<string, string[]> = {
  morning: [
    "Recovery check - open RYTHM to see your score",
    "New day, new curve - see your energy windows",
  ],
  afternoon: [
    "Your strongest peak is coming - use it wisely",
    "Peak 2 approaching - time for deep work",
  ],
  evening: [
    "Wind-down starts soon - blue light off",
    "Last stretch of the day - check your wind-down steps",
    "Shisha cutoff approaching - finish up for better sleep",
  ],
  night: [
    "Melatonin window open - time to sleep",
    "Bedtime approaching - your body will thank you",
    "No more shisha - CO needs 3h to clear before sleep",
  ],
};

function getTimeSlot(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

Deno.serve(async (_req) => {
  try {
    const sb = createClient(SB_URL, SB_SERVICE_KEY);
    // Only get RYTHM subscriptions (keys start with "rythm-")
    const { data: subs, error } = await sb
      .from("push_subscriptions")
      .select("*")
      .like("id", "rythm-%");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!subs?.length) return Response.json({ sent: 0, msg: "no subscriptions" });

    const hour = new Date().getUTCHours();
    // Rough CET/CEST offset (+1/+2) - good enough
    const localHour = (hour + 2) % 24;
    const slot = getTimeSlot(localHour);
    const pool = MSGS[slot];

    let sent = 0, failed = 0;
    for (const row of subs) {
      const sub = row.subscription;
      if (!sub?.endpoint || !sub?.keys) { failed++; continue; }
      const msg = pool[Math.floor(Math.random() * pool.length)];
      const payload = JSON.stringify({ title: "RYTHM", body: msg, tag: "rythm-" + slot });
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e: any) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await sb.from("push_subscriptions").delete().eq("id", row.id);
        }
        failed++;
      }
    }
    return Response.json({ sent, failed, total: subs.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
