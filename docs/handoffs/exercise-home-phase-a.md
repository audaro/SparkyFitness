# Handoff — Exercise home, Phase A complete

_Written 2026-08-24. Branch `feat/ai-coach`, nothing pushed._

## What shipped

Phase A of `~/fitness/EXERCISE-HOME-BLUEPRINT.md` (the mobile information architecture) is done,
A0 through A6. Phase B (target-muscle generation) was already complete before this session.

| Commit | Task |
| --- | --- |
| `233749e2` | A1 — rename mobile tabs to Home, Exercise, Food |
| `4bc4b4c8` | A1 follow-up — key the tab bar icon map to the tab names |
| `5eaefc88` | A2 — add the mobile Exercise tab |
| `e9c0d506` | A2 follow-up — keep the exercise cards visible when a refetch fails |
| `84e8f528` | A3 — move exercise surfaces onto the Exercise tab |
| `7881545f` | A4 — fold the Library tab into Food |
| `5c3f8e60` | A5 — add a REST route for the coach profile |
| `7cc2fd40` | A6 — move workout configuration onto the Exercise tab |

The tabs are now **Home, Exercise, Add, Food, Settings**. Every exercise surface lives on the
Exercise tab, every food surface on the Food tab, and `LibraryScreen` is deleted.

Each task's real decisions — including the ones the blueprint did not anticipate — are recorded in
the blueprint itself under "What A*n* actually shipped". Read those before revisiting any of it;
they are the reasons, not a summary.

## Gate status

- **Mobile** (`SparkyFitnessMobile/`): `pnpm run validate` clean.
  `pnpm exec jest --watchman=false --runInBand` → **5493 passed, 1 failed, 336 suites**. The one
  failure is the long-standing Pacific-time sleep flake in
  `__tests__/services/healthconnect/dataTransformation.test.ts` (`entry_date` off by a day). It
  fails on `main` too; ignore it.
- **Server** (`SparkyFitnessServer/`): `pnpm run validate` clean; `pnpm test` →
  **4152 passed, 290 files**.
  One caveat worth knowing: `tests/cycleRoutes.test.ts` failed **once** in five full-suite runs with
  a 401 on `DELETE /cycles/:id`. `cycleRoutes.ts` contains no 401 at all, so that response did not
  come from the route under test — it looks like cross-file contamination that surfaces with
  particular worker sharding. It is not caused by the coach-profile work (the file shares no module
  with it) and it did not recur in four subsequent runs. If it reappears, it is worth chasing
  properly rather than re-running.
- **Frontend** and **mobile** both typecheck against the new shared schema.

## Exact next step

**Phase C, task C1 — surface the recovery endpoint on mobile** (blueprint line ~547). Its
prerequisites (A2 and B2) are both done.

Note the phase ordering constraint: **C2 is a human task** (`⚠️ SVG muscle paths — DO NOT ATTEMPT`)
and blocks nothing, so C1 → C3 → C4 can proceed without it. C3 will need the paths eventually; stop
and ask rather than generating them.

## Open risks

- **The Exercise tab now carries its own date store.** `exerciseDateStore` and `diaryDateStore` are
  two instances of `createDateStore()`. Anything that resolves "the day the user is looking at"
  must go through `useAddSheetActions.getActiveDiaryDate()`, which picks between the two using
  `lastActiveTabRef` — the tab state cannot be asked, because native tabs select `Add` while the
  sheet is open. A third day-scoped tab would need to publish its day the same way or it will log
  to the wrong date silently.
- **Two screens hide themselves on a failed read, and both have a durable row backing them up.**
  The week card (`isWeekError && !week`) is backed by the Setup row; `MedicationsCard` (no doses
  due, or preference off) is backed by the Dashboard row. Both pairings have tests. Do not "tidy
  away" either row as a duplicate.
- **`isError` from React Query does not mean "no data"** — blueprint trap 13. Every screen touched
  in this phase gates on `isError && !data`. A new section that gates on `isError` alone will blank
  itself the first time the user opens the tab offline.
- **Nothing is pushed.** Eight commits sit ahead of `origin/feat/ai-coach`.
