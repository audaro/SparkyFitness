# Handoff — Exercise home, Phase A complete

_Written 2026-08-24. Branch `feat/ai-coach`, nine commits ahead of `origin/feat/ai-coach`._

## What shipped

Phase A of `~/fitness/EXERCISE-HOME-BLUEPRINT.md` (the mobile information architecture) is done,
A0 through A6. Phase B (target-muscle generation) was already complete before this session — it is
on `origin` up to `f843294e`.

| Commit | Task | On origin |
| --- | --- | --- |
| `233749e2` | A1 — rename mobile tabs to Home, Exercise, Food | yes |
| `4bc4b4c8` | A1 follow-up — key the tab bar icon map to the tab names | no |
| `e876df6f` | A1 handoff | yes |
| `5eaefc88` | A2 — add the mobile Exercise tab | no |
| `e9c0d506` | A2 follow-up — keep the exercise cards visible when a refetch fails | no |
| `84e8f528` | A3 — move exercise surfaces onto the Exercise tab | no |
| `7881545f` | A4 — fold the Library tab into Food | no |
| `5c3f8e60` | A5 — add a REST route for the coach profile | no |
| `7cc2fd40` | A6 — move workout configuration onto the Exercise tab | no |
| `8aab890b` | this handoff | no |
| `faaf0d5f` | review fix — drop the cached chat context on coach-profile PATCH | no |

The tabs are now **Home, Exercise, Add, Food, Settings**. Every exercise surface lives on the
Exercise tab, every food surface on the Food tab, and `LibraryScreen` is deleted.

Each task's real decisions — including the ones the blueprint did not anticipate — are recorded in
the blueprint itself under "What A*n* actually shipped". Read those before revisiting any of it;
they are the reasons, not a summary.

### The one review finding, reconciled

The second-opinion reviewer (gpt-5.6-sol via Codex) flagged that A5's `PATCH /api/coach-profile`
wrote the profile without dropping the cached chat context. **Valid, verified against the code, and
fixed in `faaf0d5f`.** `services/chatContextCache.ts` holds a 60-second per-user cache and
`buildCoachProfileSummary` (`services/chatService.ts:513`) reads exactly the four columns the route
writes, so the coach would have kept planning around the old session length for up to a minute
after an edit. `ai/tools/coachProfileTools.ts:151` already did the same invalidation after its own
write. Two tests pin it: the drop fires on a successful patch, and a rejected patch does **not**
evict a warm cache (so a 400 cannot be used to clear another read's context).

## Gate status

- **Mobile** (`SparkyFitnessMobile/`): `pnpm run validate` clean.
  `pnpm exec jest --watchman=false --runInBand` → **5493 passed, 1 failed, 336 suites**. The one
  failure is the long-standing Pacific-time sleep flake in
  `__tests__/services/healthconnect/dataTransformation.test.ts` (`entry_date` off by a day). It
  fails on `main` too; ignore it.
- **Server** (`SparkyFitnessServer/`): `pnpm run validate` clean; `pnpm test` →
  **4154 passed, 290 files**.
- **Frontend** and **mobile** both typecheck against the new shared schema.

### One flake worth a name

`tests/cycleRoutes.test.ts` failed **twice across roughly ten full-suite runs** with a 401 on
`DELETE /cycles/:id`. `routes/v2/cycleRoutes.ts` contains no 401 at all, so that response did not
come from the route under test — it looks like cross-file contamination surfacing under particular
vitest worker sharding. It is not caused by the coach-profile work (the file shares no module with
it) and the stashed baseline was green. **A third sighting should be the trigger to chase it
properly rather than re-run.**

## Exact next step

**Phase C, task C1 — surface the recovery endpoint on mobile** (blueprint line ~547). Its
prerequisites (A2 and B2) are both done.

The endpoint is built and tested and **has never been rendered by any UI**. C1 adds
`fetchMuscleRecovery()` to `src/services/api/workoutRecommendationsApi.ts` (which today has no
`/recovery` method), a `src/hooks/useMuscleRecovery.ts` following the existing hook pattern, a key
in `src/hooks/queryKeys.ts`, and a recovery strip on `ExerciseHomeScreen`. **`freshness` is 0.0–1.0
— the design's "100%" is `Math.round(freshness * 100)`.** Getting that wrong renders every muscle
at 1%.

Note the phase ordering constraint: **C2 is a human task** (`⚠️ SVG muscle paths — DO NOT ATTEMPT`)
and blocks nothing, so C1 → C3 → C4 can proceed without it. C3 will need the paths eventually; stop
and ask rather than generating them.

## Open risks

- **The Exercise tab now carries its own date store.** `exerciseDateStore` and `diaryDateStore` are
  two instances of `createDateStore()`. Anything that resolves "the day the user is looking at"
  must go through `useAddSheetActions.getActiveDiaryDate()`, which picks between the two using
  `lastActiveTabRef` — the tab state cannot be asked, because native tabs select `Add` while the
  sheet is open. A third day-scoped tab would need to publish its day the same way
  (`navigation.setParams({ selectedDate })`) or it will log to the wrong date silently.
- **Two screens hide themselves on a failed read, and both have a durable row backing them up.**
  The week card (`isWeekError && !week`) is backed by the Exercise tab's Setup row;
  `MedicationsCard` (no doses due, or preference off) is backed by the Dashboard row. Both pairings
  have tests. Do not "tidy away" either row as a duplicate.
- **`isError` from React Query does not mean "no data"** — blueprint trap 13. Every screen touched
  in this phase gates on `isError && !data`. A new section that gates on `isError` alone will blank
  itself the first time the user opens the tab offline, because every screen refetches on focus.
- **Nine commits are unpushed.** `origin` has A1 and its handoff; everything from `4bc4b4c8`
  onward is local only. Push to the fork (`origin` = `audaro/SparkyFitness`) only.
