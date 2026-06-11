import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("RYTHM_VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("RYTHM_VAPID_PRIVATE")!;

webpush.setVapidDetails("mailto:rythm@noreply.app", VAPID_PUBLIC, VAPID_PRIVATE);

// Convert hour float to minutes since midnight
function hourToMin(h: number): number {
  return Math.round(h * 60);
}

Deno.serve(async (_req) => {
  try {
    const sb = createClient(SB_URL, SB_SERVICE_KEY);

    // Get all push subscriptions
    const { data: subs, error: subErr } = await sb
      .from("push_subscriptions")
      .select("*")
      .like("id", "rythm-%");
    if (subErr) return Response.json({ error: subErr.message }, { status: 500 });
    if (!subs?.length) return Response.json({ sent: 0, msg: "no subscriptions" });

    // Get all schedules
    const { data: schedules, error: schedErr } = await sb
      .from("push_schedules")
      .select("*");
    if (schedErr) return Response.json({ error: schedErr.message }, { status: 500 });

    // Build a map: subscription key -> schedule
    const scheduleMap = new Map<string, any>();
    for (const s of (schedules || [])) {
      scheduleMap.set(s.id, s);
    }

    const now = new Date();
    let sent = 0, failed = 0, skipped = 0;

    // ── One-off notifications (live-activity timers completing while away) ──
    const subById = new Map<string, any>();
    for (const r of subs) subById.set(r.id, r.subscription);
    const { data: oneoffs } = await sb
      .from("push_oneoffs")
      .select("*")
      .eq("sent", false)
      .lte("fire_at", now.toISOString());
    for (const o of (oneoffs || [])) {
      const sub = subById.get(o.sub_key);
      if (sub?.endpoint && sub?.keys) {
        try {
          await webpush.sendNotification(sub, JSON.stringify({
            title: o.title || "RYTHM",
            body: o.body || "",
            tag: o.tag || "rythm-timer",
          }));
          sent++;
        } catch (e: any) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await sb.from("push_subscriptions").delete().eq("id", o.sub_key);
          }
          failed++;
        }
      }
      await sb.from("push_oneoffs").update({ sent: true }).eq("id", o.id);
    }

    for (const row of subs) {
      const sub = row.subscription;
      if (!sub?.endpoint || !sub?.keys) { failed++; continue; }

      // Find matching schedule for this subscription
      const subKey = row.id; // e.g. "rythm-abc123"
      const sched = scheduleMap.get(subKey);

      if (!sched || !sched.schedule) {
        skipped++;
        continue;
      }

      // Parse schedule
      let items: any[];
      try {
        items = typeof sched.schedule === "string" ? JSON.parse(sched.schedule) : sched.schedule;
      } catch {
        skipped++;
        continue;
      }

      // Determine local time for this user
      const tz = sched.timezone || "Europe/Prague";
      const localTime = new Date(now.toLocaleString("en-US", { timeZone: tz }));
      const localHour = localTime.getHours();
      const localMin = localTime.getMinutes();
      const nowMin = localHour * 60 + localMin;
      const todayStr = localTime.toISOString().slice(0, 10);

      // Find notifications that should fire now (within 5-min window)
      // The cron runs every 5 minutes, so check if any scheduled item falls in this window
      for (const item of items) {
        const schedMin = hourToMin(item.hour);
        const diff = nowMin - schedMin;
        // Fire if we're 0-4 minutes past the scheduled time
        if (diff >= 0 && diff < 5) {
          const payload = JSON.stringify({
            title: item.title || "RYTHM",
            body: item.body || "",
            tag: "rythm-" + (item.type || "alert"),
          });
          try {
            await webpush.sendNotification(sub, payload);
            sent++;
          } catch (e: any) {
            if (e.statusCode === 404 || e.statusCode === 410) {
              // Subscription expired - clean up
              await sb.from("push_subscriptions").delete().eq("id", row.id);
            }
            failed++;
          }
          break; // One notification per user per run
        }
      }
    }

    return Response.json({ sent, failed, skipped, total: subs.length, time: now.toISOString() });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
