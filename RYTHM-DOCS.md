# RYTHM - Circadian Rhythm PWA

**WHOOP-inspired recovery & circadian rhythm tracker for athletes.**
Single-file PWA (`rythm.html`, ~7000 lines) with service worker (`sw-rythm.js`).

---

## Architecture

- **Single HTML file** with embedded CSS + JS (no build step)
- **State management**: `ST` object persisted to `localStorage` key `rythm_state`
- **Health data**: Synced from Apple Health via Supabase Edge Function (`lqaeggkwhlqclkqhljlk`)
- **PWA**: Service worker for offline, manifest for install

---

## Views / Tabs

### 1. TODAY (Home)
- **Readiness Score** — main hero metric (0-100), color-coded green/yellow/red
- **Three Rings** — Recovery, Sleep, Strain (tap each to open full page)
- **Primary Insight** — context-aware coaching based on time of day + recovery
- **Circadian Curve** — energy curve with current time marker + phase labels
- **Metrics Row** — HRV, RHR, Sleep, Strain at a glance
- **Sleep Breakdown** — compact sleep stage bars
- **Daily Outlook** — Morning sunlight, caffeine cutoff, shisha cutoff, bedtime (all clickable)
- **Wind-down Checklist** — appears during wind-down window, 5-step routine with streak tracking
- **Live Activities** — active timers for workouts, shisha, sun exposure, walks (with progress bars)
- **Suggestions** — smart contextual suggestions (all clickable with actions)
- **Day Tasks** — simple task list with energy-phase tagging

### 2. PLAN
- **Energy + Schedule** — calendar events overlaid on circadian curve
- **Timeline by Energy** — tasks sorted by optimal energy phase

### 3. WEEK
- **Readiness 7 Days** — week strip with daily scores
- **Streaks** — sunlight, wind-down, consistency
- **Sleep Debt 14 Days** — bar chart of nightly debt
- **Recovery Impact** — behavior correlation analysis
- **Recovery Trends 30d** — HRV, RHR, Readiness trend charts
- **Pattern Insights** — automated pattern detection

### 4. HEALTH
- **Guided Breathing** — 3 patterns (4-7-8, Box, Calm) with animated orb, HRV impact tracking
- **Health Metrics Grid** — Heart rate, SpO2, respiratory rate, body temp, steps, flights, active cal, stand hours
- **Journal** — daily behavior logging (shisha, caffeine, alcohol, screens, etc.)

---

## Full Pages (Modal Overlays)

### Sleep Full Page (WHOOP-style)
- Sleep performance ring (circular SVG)
- Low sleep detection with wake-time picker (< 5h trigger)
- "Watch died" button — estimates stages from historical ratios (last 14 nights)
- HR curve colored by sleep stage
- Stage breakdown bars (Awake, Light, SWS/Deep, REM) with typical range indicators
- Sleep timeline with stage highlighting
- Hours vs. Needed breakdown (healthy min + strain add + debt add)
- Athletic Recovery Systems (CNS, Muscle, Tendon, Motor Memory, Hormonal)
- Tonight's Plan

### Recovery Full Page
- Recovery score with interpretation
- Component scores (HRV, RHR, Sleep, Training Load)
- Yesterday's behaviors impact
- CNS freshness, muscular recovery, tendon recovery, autonomic balance
- Training recommendation (green/yellow/red day)
- Insight with contributing factors

### Strain Full Page
- Strain score with breakdown
- Autonomic stress state
- Stress contributors analysis
- HRV trend over time
- De-stress strategies

### Stress Monitor Full Page
- Stress score (inverse of recovery)
- Component breakdown (HRV 40%, Sleep 25%, RHR 20%, Strain 15%)
- Autonomic state indicator
- Stress contributors
- HRV trend
- De-stress strategies with direct actions

---

## Key Algorithms

### Readiness Score
```
HRV component (30%): Based on delta from 14-day rolling median
RHR component (20%): Based on delta from 14-day rolling median
Sleep component (30%): Hours / target × 100
Training load (20%): Inverse of recent strain accumulation
```
Auto-calibrating baselines from rolling 14-day median.

### Strain Score (0-21 scale)
```
Base: activeEnergy / bodyweight mapping
Workout bonus: +2-6 per workout type
High-strain cap at 21
```

### Sleep Stages (Watch Died Estimation)
When Apple Watch battery dies during sleep:
- Uses rolling average of last 14 nights' stage ratios
- Estimates total duration from sleep start → typical wake time
- Applies historical deep/REM/light/awake percentages

### Circadian Phase Engine
Based on chronotype-adjusted wake time:
- Peak 1: wake + 2-6h
- Dip: wake + 6-8h
- Peak 2: wake + 8-11h
- Wind-down: sleep - 2h
- Sleep: configured bedtime

---

## Health Sync

- **Source**: Apple Health via iOS Shortcuts → Supabase Edge Function
- **Trigger**: Manual refresh button or pull-to-refresh gesture (no auto-polling)
- **Data pulled**: HRV, RHR, sleep (stages, start/end, in-bed), active calories, steps, flights climbed, stand hours, SpO2, respiratory rate, body temp, workouts
- **Storage**: Daily snapshots stored in `ST._dailyReadiness`, `ST._hrvHistory`, `ST._rhrHistory`, `ST._sleepHistory`, `ST._workouts`

---

## Live Activities

Trackable activities with live timers:
- **Sun Exposure** — 10min target, progress bar
- **Walk** — 30min target, progress bar
- **Workout** — 60min target, progress bar
- **Meditation** — 10min target, progress bar
- **Shisha** — cutoff warnings relative to bedtime
- **Caffeine** / **Alcohol** — behavior logging

---

## Notifications

Time-based push notifications:
- Wake recovery report
- Peak energy alert
- Caffeine cutoff
- Energy dip alert
- Wind-down reminder
- Bedtime reminder

---

## Onboarding

4-step quiz flow:
1. Wake time selection
2. Sleep time selection
3. Chronotype quiz (6 questions)
4. Goal selection (performance, sleep, stress, balance)

---

## Files

| File | Purpose |
|------|---------|
| `rythm.html` | Main PWA (HTML + CSS + JS, ~7000 lines) |
| `sw-rythm.js` | Service worker for offline/caching |
| `supabase/` | Edge functions for health data sync |
| `RYTHM-DOCS.md` | This documentation |

---

## Design System

- **Font**: Inter (weight 400-900) + DM Mono
- **Colors**: Dark theme with CSS variables
  - `--energy`: #00ec7f (green)
  - `--strain`: #ff5470 (red)
  - `--sleep`: #93a1c4 (blue-grey)
  - `--purple`: #a779f7
  - `--warn`: #ffb547 (amber)
  - `--danger`: #ff5470
- **Cards**: Rounded corners (16-20px), subtle borders, glassmorphism
- **Typography**: Large bold numbers, uppercase labels, monospace for data
