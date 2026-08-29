# Handoff — mobile UI QA harness (`qa/mobile-ui-harness`)

*Written 2026-08-29, updated the same day. Branch has 21 commits, pushed to `origin/qa/mobile-ui-harness`.*

## What shipped

`qa/` is an autonomous UI check for `SparkyFitnessMobile`: it drives the real app
in the iOS Simulator with Maestro, then decides whether the feature worked by
reading the database and the app's own log — never by reading the screen. The
design rationale, the full trap list, and the recipe for adding a scenario are in
`qa/README.md`; this file records only where the branch stands.

Eight scenarios, all green:

| scenario | what it proves | oracle checks |
| --- | --- | --- |
| `smoke` | the harness itself boots and connects | — (app log only) |
| `custom-food-log` | a food created and logged from scratch | 13 |
| `crawl` | 45 screens mount on an empty account | — (app log only) |
| `content-crawl` | the 15 detail screens content unlocks | 18 |
| `fasting-and-cycle` | screens an opted-out account never sees | 10 |
| `saved-meal` | meal built, logged, and edited | 17 |
| `food-photo` | AI photo estimate through to the diary row | 18 |
| `suggested-workout` | a generated workout's programming, and running it | 31 |

`suggested-workout` is the one that is not about reaching a screen — `crawl`
already opens Pick Muscles and `content-crawl` already runs a live workout. It is
about the *programming*: nothing in a generated workout is decided on the client,
so the muscles, exercises, sets, reps and rests are all assertions no screenshot
can make. It also shortens the workout it generates to 45 minutes before running
it, which makes two more of them real — the budget forces a trim, and the trim
has to take an isolation rather than a compound — and turns
`payload.muscles-are-the-split` into the regression test for the defect below. It also needs the second kind of setup script — not state the app
cannot create, but state the **server will otherwise fetch on its own**: the
generator imports from free-exercise-db over the network when a target muscle has
no local candidate, and a fresh QA database has no exercises at all.

**Screen coverage is complete.** Every screen a signed-in account can reach is
now walked by one of these, except `Onboarding` — which `flows/lib/boot.yaml`
walks before every scenario anyway. The "STILL NOT REACHED" lists that were the
branch's running to-do are all closed out in the flow headers.

Eight defects were found and fixed on the way, all of them real rather than test
scaffolding: the cycle day's basal temperature never saved from mobile; a new
account could not reach cycle settings at all; empty states logged themselves as
errors; four accessibility collapses (`AddSheet` / `ActionSheet`, the active
workout's set row, `ActivityAddScreen`'s form wrapper, and `AnchoredMenu`'s
dismissal backdrop wrapping the menu it dismisses) that hid whole subtrees from
VoiceOver as much as from the driver; and — found by building the duration
step above — **every regenerate from Up Next silently re-targeted the workout**.
`POST /generate` reads an absent `target_muscles` as "pick the freshest muscles",
not as "keep the ones you had", and `UpNextScreen` sent nothing but the field the
user touched: changing the length of a Push day, switching gym, or pressing
Refresh (whose own comment claims "same targets, different exercises") all handed
back a workout built around different muscles, with a perfectly normal-looking
screen. The three handlers now restate the workout they are adjusting via a
`currentContext()` helper — muscles from the payload filtered to the canonical
enum and omitted when empty, duration and gym from the row.

`suggested-workout` then grew a gym-switch step to cover the last of the three
handlers, taking it to 33 checks. The setup seeds one gym profile, deliberately
**inactive** — the generator falls back to the active profile when a request
names none, so a profile that arrived active would be consumed by the first
generate and the switch would be a no-op wearing a pass. The switch runs BEFORE
the length change, which is what makes both handlers independently provable: the
Push split has to survive the gym chip to still be there at the end, and the gym
id has to survive the length chip to still be on the row. Reversing the order
would prove only one of them.

## Gate status

- `pnpm run validate` (mobile): green, i18n audit 0 findings.
- `pnpm exec jest --watchman=false --runInBand`: 6315/6316. The one failure,
  `MealTypeSettingsScreen › concurrency: an earlier FAILED visibility update
  never rolls back a later SUCCESS`, is **flaky and unrelated** — it passes when
  that file runs alone. Pre-existing; not introduced here.
- All eight QA scenarios run green from a cold `bash qa/bin/qa-up.sh`.

## Exact next step

Push the branch, or keep it local — nothing depends on it being pushed, and the
fork's convention is sync-in-never-PR-out.

If the work continues, it is **assertions, not screens**. The obvious gaps:

1. `crawl` and `smoke` have no oracle of their own and rest entirely on
   `app-logs.mjs`. Any screen they walk that writes something is a candidate for
   a real check.
2. The recommendation family is covered for Pick Muscles, the length chip and
   the gym chip and Refresh. `suggested-workout` does not touch Swap (`swap: true` penalizes
   the previous workout's exercise ids, so the seeded catalog's second exercise
   per muscle is already there for it), Replace, On Demand, or saved workouts —
   each of which changes the plan in a way that is invisible on screen and cheap
   to assert now that the catalog and gym seeding exist. All three
   `currentContext()` callers are now covered end to end.
3. Android. Everything here is iOS-only: `qa-run.sh` shells `xcrun simctl`
   throughout, and the traps in `qa/README.md` are XCUITest's.

## Open risks

- **The photo picker tap is by coordinate**, and it is the only one in the
  harness. `PHPickerViewController` renders out of process and is invisible to
  the driver, so there is no selector to use. It is robust for the reason
  `flows/food-photo.yaml` documents — the seeded photo is always the first grid
  cell and the cell is a sixth of the screen — but it is the one step that would
  break on a device whose picker is not a three-across grid.
- **`simctl addmedia` accumulates.** Each `food-photo` run adds another copy of
  the same photograph to the simulator's library. They are byte-identical and
  share one date, so nothing can tell them apart and nothing needs to; but the
  library grows forever. `xcrun simctl erase` clears it if it ever matters.
- **The AI stub is started by `qa-up.sh` and stays up** on :3012 for every
  scenario, including the six that never call it. It listens on loopback only
  and nothing reaches it unless a run has pointed an AI service row at it, which
  only `qa/setup/food-photo.sh` does.
- **`ALLOW_PRIVATE_NETWORK_AI=true` is exported by `qa-env.sh`.** It is scoped to
  the QA server process, which can only reach the QA stack — but it is a
  production safety valve being switched off, so it is worth knowing it is there.
- **One carry-pair is still unasserted.** The gym chip is proven to carry the
  muscles forward, but not the duration: at the moment it is tapped the workout
  is still on the server's default length, so a dropped `duration_minutes` and a
  carried one produce the same 60. It is the same single `...currentContext()`
  spread that the muscle check already proves is there, and the alternative
  ordering would leave a strictly larger gap — but it is a gap, not a covered
  case, and a scenario that changed the length twice would close it.
- **None of these 21 commits has had an independent review.** The second-opinion
  reviewer has been down since 2026-08-24 (`.git/second-opinion/last-error.txt`
  is newer than `last-review.md`; the ChatGPT account is on the Free plan, which
  does not include Codex).
