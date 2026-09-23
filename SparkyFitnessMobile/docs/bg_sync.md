# Health Sync Behaviour

How the mobile app decides *what* to read from HealthKit / Health Connect, *how far
back*, and *how much workout detail* to collect. Four paths trigger a sync, and they
differ in all three.

## The four sync paths

| | Time range | Workouts enriched | Interactive | Advances cursor |
|---|---|---|---|---|
| **Background sync** | `last sync − 6 h` → now, capped at 14 days | 3 | no | yes |
| **Sync on open** | the Sync screen's range picker (default 3 days) | 25 | yes | yes |
| **Sync Now** (manual) | the Sync screen's range picker | 25 | yes | yes |
| **Import Full History** | 30-day windows, newest-first, to a probed floor | unbounded | no | **no** |

"Workouts enriched" is how many workouts per run may have their GPS route and sample
series (heart rate, speed, cadence, power) read. Everything else is sent as a summary.

### Background sync

Works from a cursor, not the range picker: *whatever changed since the last successful
sync, minus a 6-hour overlap*. The overlap exists because both platforms can deliver
records hours after the event — a workout recorded at 18:00 may not be readable until
21:00.

Clamped to a 14-day maximum lookback (`MAX_BACKGROUND_LOOKBACK_DAYS`). The cursor only
advances when a run finishes with no read errors, so a persistently failing sync would
otherwise widen its window every cycle until it could never finish (#2191). A genuinely
long gap is Import Full History's job, not this one's.

Headless, so it cannot show UI. On Android that means it skips routes needing a consent
dialog; a later interactive sync picks them up.

### Sync on open

Despite the name, this is **the same code path as pressing Sync Now** — it reads the
same range picker value (`loadTimeRange()`, default `3d`). If the picker says "Last 30
Days", opening the app syncs 30 days. It is not a lighter variant.

### Sync Now

Identical to sync-on-open except it prompts (see *Re-sending workout details* below).

### Import Full History

A one-time resumable backfill (`backfillService.ts`), reached from the Sync screen. Walks
30-day day-aligned windows newest-first from today down to a probe-derived floor, one
upload per window, with a per-server checkpoint. Notable differences:

- **Never advances `lastSyncedTime`** and never runs writeback.
- **Unbounded** telemetry budget — one context per window, so a failed window re-collects
  on retry without affecting others.
- Non-interactive, so Android routes needing consent are skipped here too.
- Its metric set is frozen in the checkpoint at first run; changing toggles requires
  Start Over.
- While it runs, `isBackfillRunning()` makes background sync stand down.

## Two window shapes per run

Every run produces both, because the two kinds of metric need different boundaries:

- `sessionStart` — for sessions (workouts, sleep). Uses the raw window start.
- `aggregatedStart` — for cumulative metrics (steps, distance, calories, floors).
  Aligned to local midnight, so a complete day's total is sent rather than a partial
  slice that would overwrite the full value server-side.

## Workout telemetry: budget and reuse cache

Reading a route plus the sample series costs roughly a second per workout, and every
result is deserialized on the JS thread. Two mechanisms keep that bounded.

### Per-run budget

`BACKGROUND_TELEMETRY_BUDGET` (3) and `FOREGROUND_TELEMETRY_BUDGET` (25) cap how many
workouts one run may enrich. Slots are claimed in list order (newest-first) *before* the
concurrent reads start, so a capped run spends its budget on the newest workouts rather
than whichever reads happen to resolve first. Workouts beyond the cap are sent as
summaries and picked up by later syncs.

### Reuse cache

`services/shared/enrichedSessionCache.ts`. Records which workouts have already had their
telemetry collected, keyed on `record id + end time`, so a bounded budget works through a
backlog across runs instead of re-picking the same newest few forever.

Three properties worth knowing:

- **It lives on the device.** Deleting the data server-side does *not* clear it. The
  workout comes back summary-only with no route.
- **It is scoped per server config.** An entry means "*this* server durably holds this
  session's telemetry", which does not carry across a server switch.
- **It is not range-aware.** There is no way to invalidate "just the last 3 days".

Added 2026-08-23 (`523ade4fc`, closing #2191), on iOS and Android together. Before that,
every foreground sync re-read every workout in range on every app open, freezing the UI
for seconds and causing duplicate diary entries from queued taps.

Checked in three places — miss any one and the behaviour is inconsistent:

| File | Purpose |
|---|---|
| `healthkit/index.ts` | iOS enrichment |
| `healthconnect/index.ts` | Android enrichment |
| `healthconnect/workoutTelemetry.ts` | Android route pre-warm — resolves consent dialogs *before* the timed reads, since a dialog waits on the user with no deadline |

## Re-sending workout details

Because of the cache, a normal sync can never re-send a route it has already sent. That
is correct for routine syncing and wrong after, say, deleting the data server-side or
fixing what gets collected.

**Sync Now** therefore asks:

```
Sync 19 Aug – 18 Sep

  Quick Sync
  Sends all your health data. Workouts already synced keep the
  map and heart rate they have.

  All Sync
  The same, and also re-reads the map and heart rate for workouts
  already synced. Slower.
```

Both options send **the whole selected range**, not a delta: a foreground sync re-reads
every enabled metric over the window and the server upserts, so steps, sleep and weight
are re-sent whether or not they changed. The choice controls one thing only — whether
already-collected workouts have their route and sample series re-read.
This is an `ActionSheet`, not `Alert.alert`: the difference between the two options cannot
be carried by a button title alone, and a native alert cannot render a second line under a
button. `ActionSheetItem.description` was added for it — optional, so the eight existing
consumers render unchanged.

The title carries the actual dates rather than "Last 30 Days", formatted through the app
locale. Four earlier wordings failed: "New Data Only" read as though it synced only
workouts; a version explaining the cache took five lines; "Sync New Data" / "Re-sync
Everything" was untrue, because both options re-send everything in the range; and
"Sync + Workout Detail" still needed the message to interpret it. The prompt is skipped when nothing has been collected yet
(`hasAnyEnrichedSessions()`), since both options would then do identical work.

Sync-on-open and background sync never prompt and never force.

### Why a run flag and not a cache wipe

`TelemetryRunContext.force` applies to one run only. Clearing the cache
(`clearEnrichedSessions()`) would be wrong: the cache is not range-aware, so wiping it to
re-send 3 days invalidates *every* workout ever collected, and later background runs
would grind back through that whole backlog three at a time — the exact starvation the
cache was added to end.

The flag only affects workouts the run already reads in the selected window. Everything
outside keeps its entry, and re-read workouts are re-committed as normal.

Threaded: `telemetryBudget.ts` → `healthSyncEngine.ts` → `healthConnectService.ts` /
`.ios.ts` → `useSyncHealthData` → `SyncScreen`.

A forced run still honours the budget, so a range holding more workouts than it takes
several runs to finish. Those runs make progress because a forced run orders its
candidates by **collection recency** rather than newest-first: `commit` re-appends a key
it already holds, so a session's position in the cache is how recently it was collected,
and `enrichedSessionOrder()` exposes that. Never-collected sessions come first, then the
least recently collected. Without that ordering the budget would hand every forced run
the same newest few and the rest of the range would never be re-read at all.

### Android route consent

Consent is remembered per record (`getRouteConsent` / `setRouteConsent`), so re-reading a
previously granted route does **not** re-prompt.

## Cursor rules

- Only **read** errors hold the cursor. `syncErrors` non-empty means `lastSyncedTime` is
  not advanced, so the next run re-covers the window.
- **Upload** errors (per-record server rejections) are reported but never hold the
  cursor — re-syncing would hit the same rejection.
- Import Full History never touches the cursor at all.

## Metric sync frequency

Due to battery and performance considerations, HealthKit metrics are categorized into
three groups with different background sync frequencies:

- Hourly: Steps, Active Calories, Total Calories, Heart Rate, Exercise Session, Distance,
  Floors Climbed
- Daily: Weight, Sleep, Blood Pressure, Body Fat, Body Temperature, Basal Body
  Temperature, Blood Glucose, Resting Heart Rate, Respiratory Rate, VO2 Max, Height, Lean
  Body Mass, Basal Metabolic Rate, Hydration, Bone Mass, Wheelchair Pushes, Blood Oxygen,
  Blood Alcohol, Menstruation/Reproductive metrics
- Foreground-only (no background delivery): Mobility metrics (walking speed/step
  length/asymmetry/double support), Running metrics (ground contact, stride length, power,
  vertical oscillation, speed), Cycling metrics (speed, power, cadence, FTP), Apple ring
  metrics (move time, exercise time, stand time)

## Related

- `sync_api.md` — the `POST /api/health-data` contract this uploads to.
- `healthkit.md` — iOS-specific read behaviour.
- `../AGENTS.md` — Health Sync section, for the orchestration rules.
