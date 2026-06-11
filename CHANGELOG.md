# RYTHM Changelog

## 2026-06-11 (v173b) - Recovery lock actually works

- Recovery score now genuinely FREEZES for the day once your morning data (sleep + HRV + RHR) is in, WHOOP-style. Previously the lock stored a value but computeReadiness() ignored it and recomputed live, so the score drifted during the day as active calories/strain accumulated and RHR updated.
- The locked value AND the breakdown bars are both frozen, so they stay consistent.
- Keyed to the 4 AM day-roll: it holds from wake until the next morning, then re-locks with that day's fresh score.
- One-time migration clears any old lock so the next sync re-locks with the corrected 30/20/30/20 score.

## 2026-06-11 (v173) - Live activities redesign

### Immersive focus view + redesigned cards
- Tapping a running live activity opens a full-screen focus timer: category label, italic title, segmented progress ring with a glowing leading dot, a bouncing mascot in the centre, big countdown, round pause button, and the other running activities as floating chips you can tap to switch.
- The background tints to the activity's colour (blue for deep work, orange for sauna, etc.) - colourful per the reference.
- Compact cards above the nav redesigned to match: segmented ring, centred mascot, big countdown, round pause, Finish/Discard. Tap a card to open the focus view.
- Each activity now has a playful mascot emoji and a category label.

### Doesn't die when you leave the app
- The timer is timestamp-based, so it stays accurate when you switch apps or lock the phone (it never silently resets).
- syncFromCloud now preserves an in-progress timer so a cloud sync from another moment/device can't wipe it.
- Screen wake-lock held while an activity runs / the focus view is open (foreground).
- Background completion alert: starting a timed activity registers a one-off web-push at its completion time (delivered by the 5-min cron), so you get pinged when it finishes even with the app closed. Cancelled/rescheduled on pause/resume/stop. New `push_oneoffs` table + extended `rythm-push` function (both deployed). Requires notifications enabled on the device.

---

## 2026-06-11 (v172) - Correctness pass

### Scoring algorithms
- Recovery weights unified to a single normalized set everywhere (HRV 30% / RHR 20% / Sleep 30% / Training 20% = 100%). Previously the engine used weights summing to 0.90 and three screens stated three different splits.
- Recovery breakdown bars now read the engine's real sub-scores (was a separate, divergent formula that disagreed with the headline number).
- Strain (0-21) is now normalized by bodyweight (relative load), per the spec; historical strain too.
- Sleep "needed tonight" centralized into one function (sleepNeedSurcharges) so the Today banner, Sleep full page, and detail all show the same number (was three different formulas/caps).
- Stress score: guarded against NaN with no data (was rendering "HIGH"); now uses overnight HRV like recovery, and the personalized sleep target.
- Circadian phases are now always contiguous (chained boundaries) - fixes the winter-mode gap that flipped the label to "NIGHT" mid-afternoon.
- Overnight HRV baseline is now a median (was a mean), matching the daytime baselines.

### Back button / navigation (the real root cause)
- Edge-swipe-to-close now routes through the overlay's real close path so history stays in sync. The old handler removed the overlay without popping history, orphaning an entry so the NEXT OS-back exited the whole PWA. This was the bug behind every prior "bulletproof back button" attempt.
- Removed the duplicate second swipe handler that fought the edge-swipe and desynced history nondeterministically.
- popstate now closes the topmost overlay by z-index (correct for stacked overlays).
- closeLog guarded against double-popping history.

### Service worker
- Removed the reload storm: a single update now reloads once (was SW tab-navigate + controllerchange + statechange = 2-3 stacked reloads).
- Fixed the offline precache (was caching `index.html?v=...` while the browser requests the bare URL, so the cache never hit). Bumped to rythm-v172.
- Notification-click focuses an existing tab by origin (was a fragile "rythm" substring match).

### Data / dates / reliability
- "Erase ALL data" now also deletes the Supabase row (was restoring from cloud on reload, so nothing was erased).
- Caffeine cutoff anchored to bedtime (~9h before), not wake+6.5h; single source of truth.
- Fixed local-vs-UTC date bugs: logging near midnight, manual wake-time override, and notification dedup were landing on the wrong day.
- Health monitor shows "Awaiting Sync" instead of a fabricated "Within Range" when there's no data; counts only metrics that have data.
- Guarded several NaN/divide-by-zero display paths (sleep breakdown %, recovery-impact averages).
- Removed dead code (malformed ring-glow line, no-op peak-time condition).

### Push notifications (background)
- The send pipeline (subscribe -> upload schedule -> rythm-push edge function) is verified working. Added `supabase/push_cron.sql` - run it ONCE in the Supabase SQL editor to schedule the function every 5 min. Without this cron, background notifications never fired (the in-app timer only runs while the app is open, which iOS suspends).

---

## 2026-05-22 (v3)

### Energy Full Page
- Energy section is now clickable - opens a scrollable full-page view
- Shows 3 summary cards: Current energy %, Peak %, and Lowest %
- Full 24-hour energy curve with live pulsing now-marker
- All 7 circadian phases as cards with time ranges, energy levels, descriptions, and actionable tip tags
- Active phase highlighted with green border and pulsing "NOW" indicator
- Removed "Summer mode - energy +5%" season badge
- Added pulsing green live-dot next to "ENERGY LIVE" label
- Chevron arrow on energy card signals it's tappable
- Time display updates every 15 seconds for a real-time feel
- SVG now-dot has animated pulsing glow ring

---

## 2026-05-22 (v2)

### Weather-Aware Sunlight Advice
- Integrated Open-Meteo API (free, no key) for real-time weather/UV data
- Morning sunlight duration adapts to conditions: 10min clear, 15-20min cloudy, 20-30min overcast/rain
- Daily Outlook shows UV index, cloud cover, and sunrise time for Ostrava
- Suggestions also use weather data for smarter sunlight recommendations
- Added longitude (18.26) to profile for accurate weather queries
- 30-minute cache to avoid excessive API calls

### Pull-to-Refresh Fix
- Fixed `passive: true` on touchmove preventing `preventDefault()` - iOS native bounce was blocking custom pull gesture
- Smooth visual pull indicator with proportional movement + opacity
- Higher threshold (80px) to avoid accidental triggers

### Wake Lock API for Live Activities
- Acquires `navigator.wakeLock.request('screen')` when a live activity starts
- Releases wake lock when all activities stop
- Re-acquires on `visibilitychange` (iOS kills wake lock on tab switch)
- Prevents iOS from suspending the app during active timers

### WHOOP Design Refinements
- Day banner redesigned to match WHOOP's "Optimal Health" card - title + paragraph + checkmark badge
- Monitor cards now say "HEALTH MONITOR" / "STRESS MONITOR" (matching WHOOP)
- Health monitor shows checkmark + "WITHIN RANGE" green text + metric count (e.g. "4/4 Metrics")
- Stress monitor shows colored level (LOW/MEDIUM/HIGH) with timestamp
- Fixed CSS circular reference on `--card-border` variable

### Week View Polish
- Reduced to 3 core metric cards (Recovery, Strain, HRV) in a clean grid matching WHOOP
- Fixed garish colors (red HRV/RHR values) - now uses white/blue/green only
- Cleaner streaks (removed fire emojis, white values)
- Proper empty states for Sleep Debt, Recovery Impact, Recovery Trends, Pattern Insights
- Sleep Debt shows "Sync sleep data to track debt" when no data
- Recovery Trends shows fallback card when no synced history

### Color Consistency
- Health monitor dots: simplified to green (normal) / amber (out of range) only - removed mid-range red
- Home metric delta badges: "down" deltas now neutral grey instead of alarming red
- Trend RHR color changed from red to neutral grey
- Week metric delta down color changed from amber to grey

### Data Cleanup
- Removed hardcoded demo sleep debt dates from DEFAULT_STATE
- Removed hardcoded step/calorie week arrays - only real synced data shows
- Fixed steps card crash on empty week array (Math.max spread on empty)

### Cleanup
- Removed all em dashes and en dashes from user-facing text and code comments

---

## 2026-05-22

### Design Overhaul - WHOOP-style consistency
- Unified all card backgrounds, borders, and border-radius using CSS variables (`--card`, `--card-border`, `--radius`)
- Standardized typography hierarchy: 900-weight hero numbers, 800-weight section labels, consistent uppercase labels
- Enlarged readiness ring (140→160px) with bolder score
- Refined bottom nav with subtler border and purple gradient center button
- Subdued brand text to gray
- Consistent `:active` states across all interactive elements
- Removed gradient from journal card — all cards now match

### Layout Changes
- Removed profile avatar from top bar
- Centered TODAY day picker, refresh button stays top-right
- Added **Day Banner** below three rings — short recovery summary with color-coded dot (replaces old "Good Day" primary insight card)
- Moved Health & Stress monitor cards below energy curve, directly above metrics grid
- Removed separate "Health Monitor" section title — monitors serve as the header

### Sickness Prediction
- New illness risk detection based on HRV drop (>15%) and RHR elevation (>5%) over 3-day rolling window
- Shows warning banner with actionable recovery tips (sleep, vitamin C, zinc, reduce intensity)
- Two severity levels: "Watch your recovery" (single signal) and "Illness risk detected" (multiple signals)

### Live Activities — iOS Dynamic Island Style
- Redesigned as floating pill bars that stick to top of screen
- Compact format: green dot + icon + name + progress bar + timer + stop button
- Fixed glitch/flicker bug — timer now updates text-only instead of rebuilding full HTML every second
- Removed old full-card live activity design

### Previous Changes (this session)
- Fixed 337-backtick syntax error (orphan code deletion)
- Fixed breathing circle text size (24px)
- Removed sleep widget from main screen
- Redesigned strain as capacity percentage
- Removed strain coach section
- Added progress bars to sun exposure and walk activities
- Implemented "Watch died" sleep stage estimation from historical trends
- Removed 1-minute health sync polling (manual refresh only)
- Integrated elite power athlete benchmarks (Berkoff 2007, Plews 2013, Charest & Grandner 2020)
- Reverted colors to original purple palette
- Fixed stress monitor threshold (0.95 for LOW)
- Fixed duplicate variable declarations
