# Sequential plans advance only on a performed session

_2026-09-23_

## What shipped

Two commits, both pushed to `main` (`1575d4726..b1463b919`).

- **`3addd900f` — `fix(workout-plans): advance a sequential plan only on a performed session`**
  A live plan session is written server-side the instant the user taps Start, with every
  prescribed set in place and `completed_at` null on all of them. `getActiveWorkoutPlanForDate`
  had no completion test, so "opened" and "finished" were the same input to
  `computeSequentialPlanProgression` and the banner advanced before a rep was lifted. The
  logged-entries query now applies the server's **performed** rule, and both clients'
  banner gates (`ExerciseSummary.tsx`, `ExerciseCard.tsx` — `performedAssignmentIds`) repeat it.
- **`b1463b919` — `test(qa): add the sequential-plan Maestro scenario`**
  `qa/flows/sequential-plan.yaml` plus its oracle, fixtures, seeder and setup, and two flow
  fragments (`dev-launcher.yaml`, `relaunch.yaml`) lifted out of `boot.yaml` so a scenario can
  relaunch the app mid-run.

## The rule, because it lives in three files

An entry counts as performed when **one set anywhere in it carries a `completed_at`** (one of
four is a session cut short, not skipped), **or when it has no set rows at all** — that second
clause is what stops a hand-logged or imported (cardio, duration-only) session from freezing the
plan on one session forever. An entry with laid-out sets and no stamp is indistinguishable from
an abandoned session and deliberately does not count. A missing `sets` array reads the same way
as an empty one.

Do **not** reach for `getWeeklySetCountInputs`' predicate here: it counts an all-unticked entry as
a plain diary log, which is exactly the abandoned live session, so it would leave the bug in
place. The right sibling is `getRecentSessionsForExercise` / `getFrequentSets`.

## Gate status

| Package  | Typecheck | Tests                       | Lint / format / Knip |
| -------- | --------- | --------------------------- | -------------------- |
| Server   | pass      | 6872 passed, 71 skipped     | (in `validate`)      |
| Frontend | pass      | 1632 passed, 168 suites     | pass                 |
| Mobile   | pass      | 7625 passed, 481 suites     | pass (+ i18n audit)  |

The full-suite server run showed two failures — `emailLogin.test.ts` and `pregnancyRoutes.test.ts`,
both 5000 ms vitest timeouts, neither touching this change — caused by running all three packages'
suites concurrently. Re-run alone with the new integration test, all 44 tests in those three files
pass. `tests/sequentialPlanProgression.integration.test.ts` does execute (it is gated on a DB
probe); it is not silently skipping.

Device: `QA_SIM_NAME="iPhone 17 Pro Max" bash qa/bin/qa-run.sh sequential-plan` — 11/11 oracle
checks, and the phase-3 screenshot reads `QA Rotation • QA Pull (2/3)` where before the fix it
read `QA Legs (3/3)`.

## Open risks

- **No independent review.** `.git/second-opinion/last-error.txt` (2026-09-23T00:20) is newer than
  `last-review.md` (Sep 18): `codex exec` hit `TimeoutExpired` after 270 s. A health check today
  returns `PONG` on the plus plan, so the reviewer is **up** — the 270 s ceiling is simply too low
  for a diff this size at `model_reasoning_effort=high`. Neither the fix nor this ship turn has
  been reviewed by anything but this session. Raising that timeout is the fix if it recurs.
- The no-set-rows escape hatch is a deliberate trade: it admits any plan-linked entry that has no
  sets, including one created by a future code path that forgets to write them. Nothing today
  produces that shape for a sequential plan (`entry_mode: 'prefill'` only matches `day_of_week`,
  which is NULL on sequential assignments), but a new writer would advance the plan silently.
- The two client gates are a copy of the server rule, not a shared helper. The "rule of two" would
  say extract on the second duplication; they are in different packages with different entry
  shapes, so it stayed duplicated and documented instead. A third copy should be extracted.

## Next step

Nothing outstanding on this defect. The nearest known issue, found during the same simulator run
and **not** addressed here, is `WorkoutComplete`'s Done button sitting under the `ActiveWorkoutBar`
while a workout is still live — noted in the QA memory, unfixed, and not yet scoped.
