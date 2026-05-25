import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Health Auto Export sends JSON:
// { data: { metrics: [ { name: "step_count", units: "count", data: [{ date, qty }, ...] }, ... ] } }
// Sleep Analysis sends: { name: "sleep_analysis", data: [{ value: "AsleepDeep", startDate, endDate, ... }, ...] }
// Workouts: { name: "workout", data: [{ name: "Running", duration, activeEnergy, startDate, endDate, ... }, ...] }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-api-key, automation-name, automation-id, automation-aggregation, automation-period, session-id",
};

function normalize(name: string): string {
  return (name || "").toLowerCase().replace(/[\s-]+/g, "_");
}

function extractValue(point: any): number | null {
  if (point == null) return null;
  if (point.qty != null) return Number(point.qty);
  if (point.Avg != null) return Number(point.Avg);
  if (point.avg != null) return Number(point.avg);
  if (point.value != null && typeof point.value === "number") return point.value;
  if (point.value != null && !isNaN(Number(point.value))) return Number(point.value);
  return null;
}

// Extract YYYY-MM-DD from various date formats
function dateKey(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  // "2026-05-22 16:18:00 +0200" or "2026-05-22T16:18:00"
  return dateStr.slice(0, 10);
}

// Parse a date string into epoch ms
function parseDate(dateStr: string): number {
  if (!dateStr) return Date.now();
  // Health Auto Export format: "2026-05-22 16:18:00 +0200"
  // Try native parsing first
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.getTime();
  // Fallback: replace space before timezone
  const fixed = dateStr.replace(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})/, "$1T$2$3");
  return new Date(fixed).getTime();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // GET: return latest value for each metric type, or full history with ?history=true
  if (req.method === "GET") {
    try {
      const sb = createClient(SB_URL, SB_SERVICE_KEY);
      const url = new URL(req.url);
      const isHistory = url.searchParams.get("history") === "true";

      if (isHistory) {
        const types = ["hrv", "sleep_hrv", "rhr", "spo2", "respiratory", "steps", "sleep", "active_cal", "skin_temp", "vo2max", "hr", "workout", "stand_hours", "flights", "weight", "nutrition_cal", "nutrition_protein", "nutrition_carbs", "nutrition_fat"];
        const historyResult: Record<string, any[]> = {};
        for (const t of types) {
          let query = sb
            .from("rythm_health_data")
            .select("value,date,unit,details")
            .eq("type", t);
          if (t === "workout") query = query.eq("unit", "min");
          const { data } = await query
            .order("date", { ascending: true })
            .limit(1000);
          if (data?.length) historyResult[t] = data;
        }
        return Response.json(historyResult, { headers: CORS });
      }

      const types = ["hrv", "sleep_hrv", "rhr", "spo2", "respiratory", "steps", "sleep", "active_cal", "skin_temp", "vo2max", "hr", "workout", "stand_hours", "flights", "weight", "nutrition_cal", "nutrition_protein", "nutrition_carbs", "nutrition_fat"];
      const result: Record<string, any> = {};

      for (const t of types) {
        // Order by DATE desc for all types — this ensures we always get the most recent
        // actual data, not a stale old entry that happened to re-sync last
        let query = sb
          .from("rythm_health_data")
          .select("*")
          .eq("type", t);
        // Filter out bogus workout entries (misclassified metrics with unit=null)
        if (t === "workout") query = query.eq("unit", "min");
        const { data } = await query
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) result[t] = data;
      }

      // Also get 7-day step history (daily aggregated)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { data: stepsWeek } = await sb
        .from("rythm_health_data")
        .select("value,date")
        .eq("type", "steps")
        .gte("date", sevenDaysAgo.toISOString().slice(0, 10))
        .order("date", { ascending: true });

      if (stepsWeek?.length) result.stepsWeek = stepsWeek;

      return Response.json(result, { headers: CORS });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500, headers: CORS });
    }
  }

  try {
    const sb = createClient(SB_URL, SB_SERVICE_KEY);

    // Read raw body first, then try to parse
    const rawText = await req.text();

    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch {
      return Response.json(
        { error: "invalid JSON", snippet: rawText.slice(0, 200) },
        { status: 400, headers: CORS }
      );
    }

    // Accept both Health Auto Export format and direct format
    const metrics = body?.data?.metrics || body?.metrics || [];

    if (!metrics.length) {
      return Response.json(
        { error: "no metrics in payload", received_keys: Object.keys(body || {}) },
        { status: 400, headers: CORS }
      );
    }

    const result: Record<string, any> = {
      received: new Date().toISOString(),
      metricsCount: metrics.length,
      metricNames: metrics.map((m: any) => m.name || m.type || "unknown"),
    };
    const processed: any[] = [];

    // Log raw workout payloads for debugging (store last 5 workout data points)
    const workoutMetrics = metrics.filter((m: any) => {
      const n = normalize(m.name || m.type || "");
      return n.includes("workout") || n.includes("exercise");
    });
    if (workoutMetrics.length > 0) {
      try {
        const samplePoints = workoutMetrics.flatMap((m: any) => (m.data || []).slice(0, 3));
        await sb.from("rythm_health_data").upsert({
          id: "debug-last-workout-payload",
          type: "debug",
          value: 0,
          date: new Date().toISOString().slice(0, 10),
          unit: "debug",
          details: { raw_fields: samplePoints.map((p: any) => Object.keys(p)), sample: samplePoints.slice(0, 2) },
          synced_at: new Date().toISOString(),
        }, { onConflict: "id" });
      } catch (_) { /* non-critical */ }
    }

    // ── Pre-pass: extract actual sleep windows (sleepStart/sleepEnd) ──
    // Used to filter HRV readings to REAL sleep time, not a fixed 22-10 window
    const sleepWindows: Record<string, { startMs: number; endMs: number }> = {};

    // 1) Check current payload for sleep data
    for (const metric of metrics) {
      const mn = normalize(metric.name || metric.type || "");
      if (!mn.includes("sleep")) continue;
      for (const pt of (metric.data || [])) {
        const ss = pt.sleepStart || pt.startDate;
        const se = pt.sleepEnd || pt.endDate;
        if (!ss || !se) continue;
        const sMs = parseDate(ss);
        const eMs = parseDate(se);
        if (eMs - sMs < 1800000 || eMs - sMs > 86400000) continue; // 30min-24h validity
        // Attribute to the date the person wakes up on
        const startDate = new Date(sMs);
        let nightKey = new Date(sMs).toISOString().slice(0, 10);
        if (startDate.getHours() < 18) {
          nightKey = new Date(sMs - 86400000).toISOString().slice(0, 10);
        }
        const existing = sleepWindows[nightKey];
        if (!existing) {
          sleepWindows[nightKey] = { startMs: sMs, endMs: eMs };
        } else {
          if (sMs < existing.startMs) existing.startMs = sMs;
          if (eMs > existing.endMs) existing.endMs = eMs;
        }
      }
    }

    // 2) If no sleep windows from payload, fetch recent sleep records from DB
    if (Object.keys(sleepWindows).length === 0) {
      try {
        const { data: dbSleep } = await sb
          .from("rythm_health_data")
          .select("date,details")
          .eq("type", "sleep")
          .order("date", { ascending: false })
          .limit(14);
        for (const row of (dbSleep || [])) {
          if (row.details?.sleepStart && row.details?.sleepEnd) {
            const sMs = parseDate(row.details.sleepStart);
            const eMs = parseDate(row.details.sleepEnd);
            if (eMs > sMs && eMs - sMs < 86400000) {
              sleepWindows[row.date] = { startMs: sMs, endMs: eMs };
            }
          }
        }
      } catch (_) { /* non-critical */ }
    }

    for (const metric of metrics) {
      const rawName = metric.name || metric.type || "";
      const name = normalize(rawName);
      const dataPoints = metric.data || [];
      if (!dataPoints.length) continue;

      // ---- CUMULATIVE METRICS: sum all data points per day ----
      if (name.includes("step_count") || name.includes("steps") || name === "step") {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v < 1) continue; // skip fractional/garbage
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + Math.round(v);
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "steps", value: total, date, unit: "steps" });
        }
      }

      else if (name.includes("active_energy") || name.includes("active_calories") || name === "active_energy_burned") {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v < 0) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + v;
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "active_cal", value: Math.round(total), date, unit: "kcal" });
        }
      }

      else if (name.includes("flights_climbed") || name === "flights_climbed") {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + Math.round(v);
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "flights", value: total, date, unit: "flights" });
        }
      }

      else if (name.includes("stand_hour") || name.includes("apple_stand_hour")) {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + Math.round(v);
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "stand_hours", value: total, date, unit: "hr" });
        }
      }

      // ---- SLEEP ANALYSIS ----
      // Summarized format: { deep: 1.08, rem: 0.49, core: 2.63, awake: 0.02, totalSleep: 4.22, sleepStart, sleepEnd, date }
      // Raw format: { value: "AsleepDeep", startDate, endDate }
      else if (name.includes("sleep_analysis") || name.includes("sleep")) {
        const nights: Record<string, { deep: number; rem: number; core: number; awake: number; inBed: number; sleepStart: string; sleepEnd: string }> = {};

        for (const pt of dataPoints) {
          // Detect summarized format (has .deep, .rem, .core fields directly)
          if (pt.deep != null || pt.rem != null || pt.core != null || pt.totalSleep != null) {
            const dk = dateKey(pt.date || "");
            // Attribute to previous day if sleep started before 6pm (overnight sleep)
            const startMs = parseDate(pt.sleepStart || pt.date || "");
            const startDate = new Date(startMs);
            let nightKey = dk;
            if (startDate.getHours() < 18) {
              const prev = new Date(startMs - 86400000);
              nightKey = prev.toISOString().slice(0, 10);
            }

            if (!nights[nightKey]) {
              nights[nightKey] = { deep: 0, rem: 0, core: 0, awake: 0, inBed: 0, sleepStart: pt.sleepStart || pt.date || "", sleepEnd: pt.sleepEnd || pt.date || "" };
            }
            const n = nights[nightKey];
            n.deep += Number(pt.deep || 0);
            n.rem += Number(pt.rem || 0);
            n.core += Number(pt.core || 0);
            n.awake += Number(pt.awake || 0);
            n.inBed += Number(pt.inBed || 0);
            if (pt.sleepStart && parseDate(pt.sleepStart) < parseDate(n.sleepStart)) n.sleepStart = pt.sleepStart;
            if (pt.sleepEnd && parseDate(pt.sleepEnd) > parseDate(n.sleepEnd)) n.sleepEnd = pt.sleepEnd;
            continue;
          }

          // Raw interval format
          const stage = (pt.value || pt.stage || "").toString().toLowerCase();
          const startStr = pt.startDate || pt.date || "";
          const endStr = pt.endDate || "";
          if (!startStr || !endStr) continue;

          const startMs = parseDate(startStr);
          const endMs = parseDate(endStr);
          const durationH = (endMs - startMs) / 3600000;
          if (durationH <= 0 || durationH > 24) continue;

          const startDate = new Date(startMs);
          let nightKey = dateKey(startStr);
          if (startDate.getHours() < 18) {
            const prev = new Date(startMs - 86400000);
            nightKey = prev.toISOString().slice(0, 10);
          }

          if (!nights[nightKey]) {
            nights[nightKey] = { deep: 0, rem: 0, core: 0, awake: 0, inBed: 0, sleepStart: startStr, sleepEnd: endStr };
          }
          const n = nights[nightKey];
          if (parseDate(startStr) < parseDate(n.sleepStart)) n.sleepStart = startStr;
          if (parseDate(endStr) > parseDate(n.sleepEnd)) n.sleepEnd = endStr;

          if (stage.includes("deep")) n.deep += durationH;
          else if (stage.includes("rem")) n.rem += durationH;
          else if (stage.includes("core") || stage === "asleep") n.core += durationH;
          else if (stage.includes("awake")) n.awake += durationH;
          else if (stage.includes("inbed") || stage.includes("in_bed")) n.inBed += durationH;
        }

        for (const [nightDate, n] of Object.entries(nights)) {
          const totalSleep = +(n.deep + n.rem + n.core).toFixed(2);
          const inBed = n.inBed > 0 ? +n.inBed.toFixed(2) : +(totalSleep + n.awake).toFixed(2);
          if (totalSleep < 0.5) continue;

          // Protect against partial re-syncs: if existing sleep data has MORE hours,
          // keep the existing record (don't let a partial sync overwrite a full night)
          const sleepId = `sleep-${nightDate}`;
          const { data: existing } = await sb
            .from("rythm_health_data")
            .select("value")
            .eq("id", sleepId)
            .maybeSingle();

          if (existing && existing.value > totalSleep) {
            // Existing record has more sleep — skip this partial data
            continue;
          }

          processed.push({
            type: "sleep",
            value: totalSleep,
            date: nightDate,
            unit: "hr",
            details: {
              deep: +n.deep.toFixed(2),
              rem: +n.rem.toFixed(2),
              core: +n.core.toFixed(2),
              awake: +n.awake.toFixed(2),
              inBed,
              sleepStart: n.sleepStart,
              sleepEnd: n.sleepEnd,
            },
          });
        }
      }

      // ---- POINT-IN-TIME METRICS: take latest per day ----
      else if (name.includes("heart_rate_variability") || name === "hrv") {
        // Store latest HRV per day for display
        const daily: Record<string, { value: number; date: string }> = {};
        // Also collect ALL readings with timestamps for sleep-window averaging
        const allReadings: { value: number; dateStr: string; epochMs: number }[] = [];

        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v <= 0 || v > 300) continue;
          const dk = dateKey(pt.date);
          const epochMs = parseDate(pt.date);
          allReadings.push({ value: v, dateStr: pt.date, epochMs });
          if (!daily[dk] || epochMs > parseDate(daily[dk].date)) {
            daily[dk] = { value: v, date: pt.date };
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "hrv", value: +d.value.toFixed(1), date: dk, unit: "ms" });
        }

        // Compute sleep HRV using ACTUAL sleep windows (sleepStart/sleepEnd)
        // Only include HRV readings that fall within real sleep time
        const nightReadings: Record<string, number[]> = {};
        for (const r of allReadings) {
          // Check each sleep window — does this reading fall inside it?
          for (const [nightKey, win] of Object.entries(sleepWindows)) {
            if (r.epochMs >= win.startMs && r.epochMs <= win.endMs) {
              if (!nightReadings[nightKey]) nightReadings[nightKey] = [];
              nightReadings[nightKey].push(r.value);
              break; // Each reading belongs to at most one night
            }
          }
        }

        // Store sleep HRV averages
        for (const [dk, readings] of Object.entries(nightReadings)) {
          if (readings.length < 1) continue;
          const avg = readings.reduce((s, v) => s + v, 0) / readings.length;
          const win = sleepWindows[dk];
          processed.push({
            type: "sleep_hrv",
            value: +avg.toFixed(1),
            date: dk,
            unit: "ms",
            details: {
              count: readings.length,
              min: +Math.min(...readings).toFixed(1),
              max: +Math.max(...readings).toFixed(1),
              sleepStart: win ? new Date(win.startMs).toISOString() : undefined,
              sleepEnd: win ? new Date(win.endMs).toISOString() : undefined,
            },
          });
        }
      }

      else if (name.includes("resting_heart_rate") || name === "rhr" || name === "resting_heart_rate") {
        const daily: Record<string, { value: number; date: string }> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v <= 20 || v > 200) continue;
          const dk = dateKey(pt.date);
          if (!daily[dk] || parseDate(pt.date) > parseDate(daily[dk].date)) {
            daily[dk] = { value: v, date: pt.date };
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "rhr", value: Math.round(d.value), date: dk, unit: "bpm" });
        }
      }

      else if (name.includes("heart_rate") && !name.includes("resting") && !name.includes("variability") && !name.includes("notification") && !name.includes("recovery")) {
        // General heart rate - take latest reading per day with min/max
        const daily: Record<string, { avg: number; min: number; max: number; date: string; count: number; sum: number }> = {};
        for (const pt of dataPoints) {
          const v = pt?.Avg ?? pt?.avg ?? pt?.qty ?? extractValue(pt);
          if (v == null || Number(v) <= 0) continue;
          const dk = dateKey(pt.date);
          if (!daily[dk]) {
            daily[dk] = { avg: Number(v), min: Number(pt?.Min ?? pt?.min ?? v), max: Number(pt?.Max ?? pt?.max ?? v), date: pt.date, count: 1, sum: Number(v) };
          } else {
            daily[dk].count++;
            daily[dk].sum += Number(v);
            daily[dk].avg = Math.round(daily[dk].sum / daily[dk].count);
            if (pt?.Min != null || pt?.min != null) daily[dk].min = Math.min(daily[dk].min, Number(pt?.Min ?? pt?.min));
            if (pt?.Max != null || pt?.max != null) daily[dk].max = Math.max(daily[dk].max, Number(pt?.Max ?? pt?.max));
            daily[dk].date = pt.date;
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "hr", value: d.avg, date: dk, unit: "bpm", details: { min: d.min, max: d.max } });
        }
      }

      else if (name.includes("respiratory_rate") || name.includes("respiratory")) {
        const daily: Record<string, { value: number; date: string }> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v <= 0 || v > 60) continue;
          const dk = dateKey(pt.date);
          if (!daily[dk] || parseDate(pt.date) > parseDate(daily[dk].date)) {
            daily[dk] = { value: v, date: pt.date };
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "respiratory", value: +d.value.toFixed(1), date: dk, unit: "br/min" });
        }
      }

      else if (name.includes("blood_oxygen") || name.includes("spo2") || name.includes("oxygen_saturation")) {
        const daily: Record<string, { value: number; date: string }> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v <= 50 || v > 100) continue;
          const dk = dateKey(pt.date);
          if (!daily[dk] || parseDate(pt.date) > parseDate(daily[dk].date)) {
            daily[dk] = { value: v, date: pt.date };
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "spo2", value: Math.round(d.value), date: dk, unit: "%" });
        }
      }

      else if (name.includes("body_temperature") || name.includes("wrist_temperature") || name.includes("body_temp")) {
        const daily: Record<string, { value: number; date: string }> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null) continue;
          const dk = dateKey(pt.date);
          if (!daily[dk] || parseDate(pt.date) > parseDate(daily[dk].date)) {
            daily[dk] = { value: v, date: pt.date };
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "skin_temp", value: +d.value.toFixed(1), date: dk, unit: "C" });
        }
      }

      else if (name.includes("weight") || name.includes("body_mass") || name.includes("body_weight")) {
        const daily: Record<string, { value: number; date: string }> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v <= 20 || v > 300) continue; // sanity check kg
          const dk = dateKey(pt.date);
          if (!daily[dk] || parseDate(pt.date) > parseDate(daily[dk].date)) {
            daily[dk] = { value: v, date: pt.date };
          }
        }
        for (const [dk, d] of Object.entries(daily)) {
          processed.push({ type: "weight", value: +d.value.toFixed(1), date: dk, unit: "kg" });
        }
      }

      // ---- NUTRITION (from SnapCalorie via Apple Health) ----
      else if (name.includes("dietary_energy") || name === "dietary_energy_consumed") {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v < 0) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + v;
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "nutrition_cal", value: Math.round(total), date, unit: "kcal" });
        }
      }

      else if (name.includes("dietary_protein")) {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v < 0) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + v;
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "nutrition_protein", value: +total.toFixed(1), date, unit: "g" });
        }
      }

      else if (name.includes("dietary_carbohydrate") || name.includes("dietary_carbs")) {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v < 0) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + v;
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "nutrition_carbs", value: +total.toFixed(1), date, unit: "g" });
        }
      }

      else if (name.includes("dietary_fat") || name.includes("dietary_total_fat")) {
        const dailyTotals: Record<string, number> = {};
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v == null || v < 0) continue;
          const dk = dateKey(pt.date);
          dailyTotals[dk] = (dailyTotals[dk] || 0) + v;
        }
        for (const [date, total] of Object.entries(dailyTotals)) {
          processed.push({ type: "nutrition_fat", value: +total.toFixed(1), date, unit: "g" });
        }
      }

      else if (name.includes("vo2") || name.includes("cardio_fitness")) {
        for (const pt of dataPoints) {
          const v = extractValue(pt);
          if (v != null && v > 0) {
            processed.push({ type: "vo2max", value: +v.toFixed(1), date: dateKey(pt.date), unit: "ml/kg/min" });
          }
        }
      }

      // ---- WORKOUTS ----
      // Match "workout" or "exercise" but NOT sub-metrics like "workout_route"
      else if ((name === "workout" || name === "workouts" || name === "exercise" || name === "exercise_time" || name.includes("workout_type")) && !name.includes("route")) {
        for (const pt of dataPoints) {
          // Skip entries that look like simple metric readings (have qty + source but no start/end)
          // These are likely VO2Max or other metrics from workout context
          if (pt.qty != null && pt.source && !pt.startDate && !pt.endDate && !pt.duration && !pt.name) {
            continue;
          }

          const wType = pt.name || pt.workoutActivityType || pt.type || "Workout";

          // Duration: try explicit field first (seconds → minutes), then compute from start/end
          let durMin: number | null = null;
          if (pt.duration && Number(pt.duration) > 0) {
            durMin = Number(pt.duration) / 60;
          } else if (pt.totalDuration && Number(pt.totalDuration) > 0) {
            durMin = Number(pt.totalDuration) / 60;
          } else if (pt.startDate && pt.endDate) {
            const startMs = parseDate(pt.startDate);
            const endMs = parseDate(pt.endDate);
            const calcMin = (endMs - startMs) / 60000;
            if (calcMin > 0 && calcMin < 1440) durMin = calcMin; // sanity: < 24h
          }

          // Calories: check multiple possible field names from HAE
          const cal = pt.activeEnergyBurned ?? pt.activeEnergy ?? pt.totalEnergyBurned ?? pt.totalEnergy ?? pt.energyBurned ?? pt.qty ?? null;

          const dk = dateKey(pt.startDate || pt.date || "");
          processed.push({
            type: "workout",
            value: durMin ?? 0,
            date: dk,
            unit: "min",
            details: {
              type: wType.replace(/HKWorkoutActivityType/i, ""),
              durMin: durMin ? Math.round(durMin) : 0,
              cal: cal ? Math.round(Number(cal)) : 0,
              startDate: pt.startDate,
              endDate: pt.endDate,
            },
          });
        }
      }
    }

    // Deduplicate by ID (PostgreSQL can't upsert same row twice in one batch)
    // For cumulative types, values are already summed per day. For workouts, keep all as separate entries.
    const deduped = new Map<string, any>();
    for (const p of processed) {
      const id = p.type === "workout"
        ? `${p.type}-${p.date}-${p.details?.type || ""}-${p.details?.startDate || Math.random()}`
        : `${p.type}-${p.date}`;
      deduped.set(id, { ...p, _id: id });
    }

    // Store in Supabase with daily keys
    const rows = [...deduped.values()];
    if (rows.length) {
      const { error } = await sb
        .from("rythm_health_data")
        .upsert(
          rows.map((p) => ({
            id: p._id,
            type: p.type,
            value: p.value,
            date: p.date,
            unit: p.unit || null,
            details: p.details || null,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: "id" }
        );

      if (error) {
        result.dbError = error.message;
      }
    }

    result.processed = processed.length;
    result.types = [...new Set(processed.map((p) => p.type))];

    return Response.json(result, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
