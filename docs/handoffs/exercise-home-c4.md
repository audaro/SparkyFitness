# Handoff — Exercise home, C4 complete (Pick Muscles is reachable; Phase C is done)

_Written 2026-08-24. Branch `feat/ai-coach`, four commits ahead of `origin/feat/ai-coach`, tree clean._

## What shipped

Task **C4** of `~/fitness/EXERCISE-HOME-BLUEPRINT.md` — wire Pick Muscles into Up Next. That closes
Phase C. **C2 is still the unstarted human SVG task and still blocks nothing** (the D5 fallback
carries the grid).

| Commit | What | On origin |
| --- | --- | --- |
| `ca5b15d0` | C3 — add muscle and split targeting to the mobile app | no |
| `7de430dd` | review fix — keep the muscle grid up when the screen is backed out of | no |
| `a7bf9cab` | C3 handoff | no |
| `1eb485fe` | C4 — open muscle targeting from Up Next | no |

C4 touched three files: `src/screens/UpNextScreen.tsx` (+26), its test (+76, six new tests), and one
clause in `SparkyFitnessMobile/AGENTS.md`. No new files.

### The one decision, and the one thing D1 must undo

`UpNextScreen` now declares a **`kind: 'text'` right header item labelled "Muscles"** that pushes
`PickMuscles`. It is deliberately on the *header*, not beside the Swap button:

`renderContent()` only reaches the Swap button once a recommendation exists. In the `isLoading`,
`isError` and "No workout yet" branches the body is a `StatusView`, which takes exactly one
`action` — and "no workout yet" is precisely when choosing what to train matters most. A
body-level affordance would have been missing from the state that needs it. The header renders in
every branch. That reasoning is recorded in a comment at the call site and asserted by the test
`is reachable before any workout exists`; do not "tidy" the button into the body without
re-reading it.

Three properties the tests pin, so a later edit cannot quietly break them:

1. **`role` is undefined** — the screen still declares zero primary header actions. `useScreenHeader`
   throws in `__DEV__` on a second primary, so D2's ⋯ menu can be added to `right` as an array
   without conflict *provided* neither is made primary.
2. **Disabled while `isGenerating || isStarting`** — otherwise the picker's generate races the one
   already in flight for the same recommendation row and the loser silently wins the cache.
3. **Whole-workout Swap is untouched.** `handleSwap` → `runGenerate({swap: true}, 'swap')` is
   byte-identical. The test `leaves whole-workout Swap alone` asserts pressing it still generates
   and does *not* navigate to `PickMuscles`.

**D1 supersedes this header action.** Once the Swap sheet exists, Pick Muscles is one of its four
rows and the Swap *button* is what opens it. The "Muscles" header item should then be **removed** —
but check the empty state first: the sheet is opened from the Swap button, which still does not
render when there is no workout, so D1 inherits the exact gap C4 routed around. Decide deliberately
rather than deleting the header item on autopilot.

## Gate status

Run from `SparkyFitnessMobile/`:

```bash
pnpm run validate && pnpm exec jest --watchman=false --runInBand --coverage=false
```

- `pnpm run validate` clean (tsc, expo lint, i18n audit).
- Full suite: **5546 passed, 1 failed, 343 suites**. The single failure is the long-standing
  Pacific-time sleep flake in `__tests__/services/healthconnect/dataTransformation.test.ts`
  (`entry_date` off by a day). It fails on a clean tree. Ignore it; do not chase it.
- `__tests__/navigation/nativeHeaderContract.test.ts` green. `PickMuscles` still needs no
  `NATIVE_TABS_ROUTE_EXCLUSIONS` entry.
- Server/frontend/shared untouched this session.

## Device testing — this is live, and the setup is non-obvious

A **Debug dev-client build is installed on the iPhone** and verified working. Reproducing this cost
real time; the traps are worth reading before rebuilding anything.

- **Device:** an iPhone 17 Pro Max on iOS 27.0, paired over USB.
  **`xcrun devicectl list devices` prints an "Identifier" that is a CoreDevice UUID, and
  `expo run:ios --device` rejects it.** Get the real hardware UDID from
  `xcrun xctrace list devices`, or from `devicectl list devices --json-output <file>` →
  `hardwareProperties.udid`.
- **Build command:** `pnpm exec expo run:ios --device <udid>` from
  `SparkyFitnessMobile/`. **No `expo prebuild` needed** — the last native change was
  `expo-speech-recognition` (`202604b7`, Aug 22 12:49) and the prebuild ran at 12:50 right after.
  Nothing has touched `app.config.ts`, `plugins/`, `targets/`, `patches/` or dependencies since.
- **`.dev` in the bundle id is `APP_VARIANT`, not the build configuration.** The build that was on
  the phone before this session was `Release-iphoneos` with a baked-in 14 MB `main.jsbundle` — it
  never talks to Metro and has no reload. Confirm which you have by checking for `main.jsbundle` in
  the `.app`: present ⇒ frozen JS ⇒ a rebuild is genuinely required. The current Debug build has
  none, plus `EXDevLauncher.bundle` / `EXDevMenu.bundle`, so **JS changes need only shake-and-reload**.
- **Set the app's server URL to the tailnet HTTPS origin** — `tailscale serve status` shows it
  mapping `/` → `http://localhost:3010`, so it is the bare `https://<magicdns-name>` with no port.
  Confirm with `curl` that `/api/health` returns 200 before blaming the app.
- **The Tailscale trap:** plain `http://` over Tailscale is **rejected by the app itself**, even
  though `curl` is perfectly happy with it. `getInsecureUrlError` (`src/utils/serverUrl.ts:72`)
  allows HTTP only when `__DEV__ && isPrivateOrLocalHost(url)`, and Tailscale's CGNAT range
  `100.64.0.0/10` classifies as **`carrierGradeNat`** in ipaddr.js — which is *not* in
  `PRIVATE_IP_RANGES = ['loopback','private','linkLocal','uniqueLocal']`. `.ts.net` is not in the
  local-TLD allowlist either. So both a `100.x` address and a bare MagicDNS name over `http://`
  fail; only the HTTPS Serve origin passes. (An RFC-1918 LAN address over HTTP does work, because
  that classifies as `private` — but only while on the same network.)
- **Metro** is separate from the API URL and not subject to that validation: it is reachable over
  the tailnet at `http://<tailscale-ip>:8081` if the phone leaves Wi-Fi.
- **The local API server must be running from this working tree** (`SparkyFitnessServer`, port 3010)
  and must have been **started after `480286b0`** (Aug 24 09:36, "Honour client-requested target
  muscles in the planner"), or muscle targeting degrades *silently* — a generic workout comes back
  with no error saying the selection was dropped. Node does not hot-reload; restart it if in doubt.

The app was opened on device and the reorganization plus C4 were confirmed visually.

## Exact next step

**Phase D, task D1 — the Swap sheet** (blueprint §D1). Four rows, per screenshot 1:

| Row | Goes to | Status |
| --- | --- | --- |
| Pick Muscles | `PickMuscles` | exists (C3) |
| Saved Workouts | `WorkoutPresetsLibrary` | exists |
| Create From Scratch | `WorkoutPresetForm` | exists |
| On Demand | D3 | **does not exist yet** |

**Commit:** `Add the Swap Workout sheet`

Four things verified against the code today:

1. **`src/components/ActionSheet.tsx` is the component to use — do not write a new sheet.** It is a
   titled `BottomSheetModal` taking `ActionSheetItem[]` (`key`/`label`/`group`/`destructive`/
   `dismissOnPress`) with a ref-based `present()`/`dismiss()`. Already used by
   `ActiveWorkoutScreen`, `WorkoutDetailScreen`, `ActiveWorkoutHeader`, `WorkoutFormExerciseList`
   and `BumpPhotoJournal`; covered by `__tests__/components/ActionSheet.test.tsx`.
2. **`dismissOnPress: false` exists specifically for a main-menu → pick-list stage**, which is worth
   knowing if On Demand (D3) wants to expand in place rather than push a screen.
3. **All three existing targets are registered root-stack routes** — `WorkoutPresetsLibrary:
   undefined`, `WorkoutPresetForm` (takes params), `PickMuscles: undefined` in
   `src/types/navigation.ts`. No A0 three-file dance needed unless D3 adds a screen.
4. **The Swap button currently regenerates.** Repointing it at the sheet moves
   `runGenerate({swap: true})` behind D2's "Refresh" row. Do not lose it — that is the only
   whole-workout swap path, and its test (`regenerates with swap when Swap is pressed`) will need
   to follow it rather than be deleted.

After D1: D2 (⋯ menu) → D3 (on-demand) → D4 (docs), then Phase E.

## Open risks — all carried forward unchanged, none introduced by C4

- **`GymProfilesScreen` has the Android-back gap C3 fixed in `PickMusclesScreen`.** Its editor mode
  sets `gestureEnabled`/`headerBackVisible` but registers no `beforeRemove` listener, so Android's
  hardware back pops the screen out from under an in-progress edit. Real, unfixed, out of scope.
- **`useScreenHeader` does not honour a `kind: 'text'` left item.** Its comment claims a text left
  item replaces the system back button, but only `dismiss` sets `headerBackVisible: false`. Fix the
  hook if a screen needs a labelled Cancel.
- **`` `${color}20` `` alpha suffixes are silently dropped** — the theme's values are `hsl(...)`
  strings and `processColor` returns the same opaque colour. `WorkoutCard.tsx:53` and
  `SwipeableExerciseRow.tsx:126` render fully saturated where a wash was intended. Cosmetic.
- **Nothing refetches on app foreground or day rollover.** `useFocusEffect` does not re-fire when
  the app foregrounds onto an already-focused tab, so an Exercise tab left open overnight shows
  yesterday's numbers. Fix belongs at screen level: one AppState `active` effect on
  `ExerciseHomeScreen`, following `useFasting.ts:285`. Still unassigned — fold into D4 or give it
  its own task.
- **`weeklySetTargetsQueryKey` is still not invalidated by exercise writes.** Its key is a factory,
  so a fix invalidates by the `['weeklySetTargets']` prefix.
- **Health sync deliberately does not invalidate recovery.** An imported session has no sets, so it
  cannot move a freshness score — only `last_trained`, which nothing renders yet. Revisit
  `refreshHealthSyncCache` when E3 or later surfaces it.
- **`isError` from React Query does not mean "no data"** — blueprint trap 13. `PickMusclesScreen`
  never reads the flag; the grid renders every tile regardless, showing `—` for a missing
  percentage. Keep new sections to that shape.
- **Four commits are unpushed.** Push to the fork (`origin` = `audaro/SparkyFitness`) only.
