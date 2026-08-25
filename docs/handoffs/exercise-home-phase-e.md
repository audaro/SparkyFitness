# Handoff — Exercise home & muscle targeting: Phase E complete

Phase E is done, and with it the whole of `~/fitness/EXERCISE-HOME-BLUEPRINT.md`. The web app went
from **zero** references to the suggested-workout family to carrying all of it, and its navigation
now says the same thing mobile's does: food is one place, training is another.

## What shipped

| Task | Commit      | What it added                                                      |
| ---- | ----------- | ------------------------------------------------------------------ |
| E1   | `7c6a20fb`  | Gym profile management on the web                                  |
| E2   | `45850f21`  | Up Next — the generated workout, plus the recommendation API/hooks |
| E3   | `d8c5d292`  | Recovery and weekly set targets                                    |
| E4   | this commit | The nav restructure, the `AGENTS.md` pass, and this handoff        |

Then, after the phase closed (see E5 and E6 below):

| Task | Commit      | What it added                                                          |
| ---- | ----------- | ---------------------------------------------------------------------- |
| E5   | `77a88c900` | Start workout on the Up Next card                                      |
| E5   | `f232deda7` | The in-progress guard, extracted and applied to all three entry points |
| E6   | `56480410a` | `ConfirmationDialog` translates its own labels                         |
| E6   | `ff65d9f87` | `ConfirmationDialog` announces its description                         |

### What E4 restructured, and the four calls behind it

The blueprint gives E4 one line — "web nav restructure mirroring Phase A". Web's information
architecture is not mobile's, so here is what "mirroring" resolved to, and what it deliberately did
not.

1. **Food and Exercise lead; the day's exercise moved with them.** `/` is now labelled Food and
   `/exercises` Exercise, and they are the first two tabs on both the desktop nav and the small-screen
   bottom bar. The diary's exercise widget moved to `pages/Exercises/ExerciseDayCard.tsx`, so
   `/exercises` is the whole training story top to bottom: what to do next, this week against target,
   how recovered you are, what you actually did, then the library you build it from.

2. **The Exercise page owns its own day.** Both pages keep the selected day in their own `?date=`
   search param, so paging back through last week's workouts does not move the food diary and vice
   versa. Mobile needed an explicit rule here (A3's `getActiveDiaryDate` had to be taught which tab's
   day the Add sheet meant); the web has no shared logging affordance that could pick the wrong one,
   so two independent params are the whole mechanism.

3. **The food library stopped being a tab, but did not get folded into the page.** `/foods` is still a
   route, reached from `pages/Diary/FoodLibraryCard.tsx` and from the "+" menu on small screens.
   Inlining it would have been the closer visual match to `/exercises`, and it was rejected on
   cold-load grounds: the foods table, meals and the meal-plan calendar are ~2,300 lines and three
   more list queries, and `/` is the route every session starts on. This is the same call A4 made on
   mobile in the other direction — the Food tab links to the library screens explicitly to keep their
   counts off its cold load. The asymmetry with `/exercises`, which does inline its library, is
   inherited from E1–E3 and left alone.

4. **A delegate keeps the exercise widget on the diary, and keeps the Diary label.** This is the one
   that would have shipped as a regression. A delegate's tab list has never included `/exercises` —
   recommendations, gym profiles and weekly targets are owner-only at the RLS layer — and
   `isCurrentPathAllowed` redirects them off any route not in that list. Moving the widget
   unconditionally would have taken exercise entries away from the only nav they have. So the widget
   is pushed only while `isActingOnBehalf`, and `/` keeps its Diary label for them, because for a
   delegate it really is still the whole diary.

That last one had a consequence worth naming separately: **`generateDefaultLayouts` hard-coded an
`exercise` tile**, and `reconcileLayouts` returns defaults verbatim when nothing is saved. A widget
that is now conditional cannot have an unconditional default tile, or every new user's saved layout
carries a phantom entry. Both it and `buildWidgetKeys` take an `includeExercise` flag now, keyed off
`EXERCISE_WIDGET_KEY` rather than a repeated string literal, and `DiaryWidgetGrid` derives it from
the widget set the page is actually rendering.

**i18n:** two new fork keys, `nav.food` and `nav.exercise`, rather than overriding upstream's
`nav.diary` / `exercise.title` values. The mobile playbook prefers overriding a value so the `.tsx`
stays byte-identical to upstream, but that rule buys nothing here — the tab arrays are being
restructured anyway, so every one of those lines conflicts regardless, and `exercise.title` is a
generic key upstream may yet use as a page heading. Both call sites pass a `defaultValue`, so the 27
machine-synced locales render English rather than a raw key until the pipeline catches up.

## Gate status

Green, run per the blueprint's validation matrix. Only `SparkyFitnessFrontend/` was touched.

| Package                  | Command             | Result                        |
| ------------------------ | ------------------- | ----------------------------- |
| `SparkyFitnessFrontend/` | `pnpm run validate` | clean (tsc, eslint, prettier) |
| `SparkyFitnessFrontend/` | `pnpm test`         | **1066 passed, 108 suites**   |

Baseline before E4 was 1045 passed / 105 suites; E4 adds two suites (6 tests) plus two cases on
`dashboardLayout.test.ts`, and the start-workout work below adds 15 more across the existing
`workoutPlayback` and `UpNextCard` suites.

**After E5 and E6 the gate stands at 1081 passed / 111 suites**, still clean. Those add
`useWorkoutPlaybackStart.test.tsx` (6), `ExerciseCard.test.tsx` (2, its first suite),
`ConfirmationDialog.test.tsx` (5, also its first) and two cases on `WorkoutPresetsManager.test.tsx`.

## Exact next step

**The blueprint is finished**, and the one gap it left that was a broken promise rather than a
missing feature — a generated workout you could look at but not start — is closed too (see below).
What is left is the standing backlog; nothing in it blocks anything else, and none of it is on a
critical path.

## E5 — Start workout on the web Up Next card (**closed 2026-08-24**, after this phase shipped)

This was open item 1 and is now done; it is written up here rather than deleted because the
diagnosis it corrects is the reusable part.

`createWorkoutPlaybackDraftFromRecommendation` in `utils/workoutPlayback.ts` maps the payload to a
playback draft, `UpNextCard` gained a Start workout button, and
`useUpdateWorkoutRecommendationStatusMutation` marks the row `started` the way mobile does. The
payload already arrives in the draft's own units (kg, km, whole seconds) and in the set-type
vocabulary the web writes, so the mapping is a rename with three decisions in it: order by
`sort_order` rather than array position (Replace rewrites a row in place), cardio keeps `distance`
and zeroes `rest_time` while everything else does the reverse, and a set with no `rest_time` of its
own falls back to the exercise's `rest_seconds` — the number the card showed as its rest chip.

**The blocker this was originally filed under did not exist.** `WorkoutPlaybackDraft.preset_id` reads
like a hard constraint — required `string`, and a recommendation is not a preset — but it was written
once and read once, by the draft's own type guard. Nothing resolves a preset through it, drafts are
keyed in storage by `entry_date`, and `buildPresetSessionCreateRequestFromDraft` never sends it. It
is now `string | null`, null for a generated workout, with the guard widened to match. Generalize
this: **a required field with no reader is a storage artifact, not a contract** — grep for its
consumers before designing around it. The cost of not doing so here was a plan involving a synthetic
preset and a `shared/` extraction, neither of which was needed.

Mobile's `buildRecommendationDraftExercises` was a reference, not a donor, as expected: it targets
the preset _form_ type (display strings in the user's units, mobile's set-type vocabulary, client
ids), so only its field-by-field decisions carried over.

**One hazard was found and fenced, on all three entry points.** A route-state draft _replaces_
whatever is in `localStorage` for that day, so starting a workout on a day that already has an
unfinished one silently discards it. Starting now prompts, offering Resume (navigate with **no**
draft, so the page falls back to the stored one) or Start new. The two preset entry points —
`ExerciseCard.handleWorkoutPresetSelected` and `WorkoutPresetsManager.handleStartWorkoutPlayback` —
carried the identical pre-existing hazard, so with three call sites the guard became
`hooks/Exercises/useWorkoutPlaybackStart.tsx` rather than a third copy: it owns the storage check,
the prompt, and the navigate, and returns `{ requestStart, guardDialog }`. A fourth entry point that
navigates to `/workout-playback` on its own reintroduces the data loss, which is why the check lives
behind the only sanctioned way in.

Two details of that hook are load-bearing. `createDraft` is a **callback**, not a draft: a draft
stamps `started_at` when it is built, so building one for a start the user then cancels would carry a
start time that never happened. And Resume passes no draft at all — falling back to the stored draft
is exactly what resuming means, and passing one would be the overwrite being guarded against.

Rewiring the presets manager surfaced an adjacent wrong-day bug: both `handleStartWorkoutPlayback`
and `handleLogPresetToDiary` dated the workout with `formatDateToYYYYMMDD(new Date())` — the
machine's local date — so for a user whose timezone differs from their laptop's, logging a preset and
starting it could land on two different days. Both use `todayInZone(timezone)` now. The diary card is
the deliberate exception: it starts on the day being viewed (`selectedDate`), because the diary is a
day view.

Also worth knowing: the workout is always logged to **today in the user's timezone**, never the
`?date=` the Exercise page browses with, because it was programmed against today's recovery.

### E6 — `ConfirmationDialog`, fixed on the way past (**2026-08-24**)

Two defects the new prompt inherited, both pre-existing, both affecting all six callers rather than
just this one.

**It was half translated.** Callers passed a translated title, description and action labels into a
dialog that then rendered its own "Cancel", "Confirm" and "Warning" in English regardless of locale.
Those come from `common.cancel` / `common.confirm` / a new `common.warning` now, and `cancelLabel`
joins `confirmLabel` as an override for the dialog where "Cancel" is the wrong word.

**The description was never announced.** It rendered in a plain `div`, so it was not wired to the
dialog's `aria-describedby` — a screen reader read the title and the buttons but not the sentence
explaining what confirming does, which on a destructive dialog is the part that matters. Radix warned
about it on every mount; that warning is now absent from the whole test run. The fix is
`DialogDescription` with **`asChild` over a `div`**, not its default `<p>`: `description` is typed
`React.ReactNode` and callers pass lists and stacked paragraphs, which a `<p>` cannot legally
contain — React would hoist them out of the very element `aria-describedby` points at, breaking the
fix in exactly the cases where the description is long enough to need it.

`src/tests/components/ConfirmationDialog.test.tsx` covers both: `t` is mocked to return the **key**,
so any English prose reaching the DOM is a string that skipped i18n, and the aria cases assert the
described element resolves, is a `DIV`, and keeps a list intact inside it.

## Open items

- **The web weekly-targets card is linear bars where mobile draws a Skia hexagon.**
  `WeeklySetTargetsCard.tsx` renders one `h-2` bar per training group;
  `HexagonProgressRing.tsx` on mobile draws a radial hexagon. Feature parity yes, visual parity no —
  the same four numbers, told two different ways. Deliberate (there is no Skia on the web and the
  ring is not worth an SVG reimplementation for one card), but it means a screenshot of the two
  platforms side by side does not read as one product.

Carried forward, still true:

- **C2, the anatomical SVG muscle paths, is still the only human-blocked task and still blocks
  nothing.** `MuscleTile` renders a labelled colour block when given no `svgPath`; the seam is the
  `svgPath` + `svgViewBox` prop pair. Five canonical muscles have no path: `lats`, `middle back`,
  `abductors`, `adductors`, `neck`.
- **Muscle targeting is mobile-only.** Pick Muscles, the split list and On Demand have no web
  counterpart; the web can choose a duration and regenerate, nothing more. `target_muscles` is on
  the wire contract, so this is a UI gap, not a contract one.
- **Nothing refetches on app foreground or day rollover (mobile).** An Exercise tab left open
  overnight shows yesterday's numbers. Still unassigned; the fix belongs at screen level, one
  AppState `active` effect on `ExerciseHomeScreen`, following `useFasting.ts:285`.
- **`utils/workoutSupersets.ts`, `hooks/useWorkoutRecommendation.ts` and `hooks/useGymProfiles.ts`
  have no test suites of their own** (mobile) — covered only through the screens that use them.
- **Per blueprint D10, the two web body-map implementations stay unconsolidated.**
  `BodyMapFilter.tsx` and `WorkoutSessionBodyMap.tsx` duplicate the asset. Real, out of scope.
- **`weeklySetTargetsQueryKey` is still not invalidated by exercise writes** (mobile). Its key is a
  factory, so a fix invalidates by the `['weeklySetTargets']` prefix.
- **Health sync deliberately does not invalidate recovery.** An imported session has no sets, so it
  cannot move a freshness score — only `last_trained`, which nothing renders yet. Still nothing
  renders it: the web recovery card does not surface it either.
- **Two competing equipment stores.** `coach_profiles.equipment` is AI-chat-only and not read by the
  generator; `gym_equipment_profiles.equipment` is what the generator reads. Do not add a third, and
  do not unify them here.

## Merge exposure this phase adds

Worth knowing before the next upstream sync. **A sync run on 2026-08-24 after E6 was a no-op** —
`upstream/main`, `upstream/dev` and `upstream/dev2` are all ancestors of this branch, and the single
upstream branch ahead of `main` (`nix/update-pnpm-hashes`) has an empty diff against it. There is no
in-flight upstream work touching any file the fork has modified.

Until now the fork's conflict surface was mobile-only
(16 files on the 341-commit merge of 2026-08-24, all of them files the fork edited in place or
deleted). E4 opens a **second permanent conflict zone on the web**: `layouts/MainLayout.tsx` holds
both nav arrays and upstream edits them regularly (the cycle and medications conditionals are
recent), and `pages/Diary/Diary.tsx`'s widget registry is likewise upstream's. Everything else E4
added is a new file, which historically has cost nothing.

The tab lists were **not** extracted into a helper, on purpose. Doing so would read as cleaner and
would make every future upstream nav change conflict against an array that no longer exists in the
file they edited. In-place edits are the cheaper trade here.

E5 and E6 add little to that surface, but not nothing. `utils/workoutPlayback.ts`,
`pages/Diary/ExerciseCard.tsx` and `pages/Exercises/WorkoutPresetsManager.tsx` are upstream files
edited in place; the guard itself is a new file.

**Measured 2026-08-24, against `upstream/main` at `fda0c167f`.** The fork's whole delta is 157 added
files, 123 modified, 2 deleted. Only modified files can conflict, and their risk is upstream's churn
rate, not their importance. For the 18 web files the fork has modified, six months of upstream
commits each:

| Upstream commits (6mo) | File                                        |
| ---------------------- | ------------------------------------------- |
| 137                    | `public/locales/en/translation.json`        |
| 23                     | `layouts/MainLayout.tsx`                    |
| 22                     | `pages/Diary/Diary.tsx`                     |
| 14                     | `pages/Diary/ExerciseCard.tsx`              |
| 11                     | `pages/Exercises/WorkoutPresetsManager.tsx` |
| 8                      | `utils/workoutPlayback.ts`                  |
| …                      | …                                           |
| 1                      | `components/ui/ConfirmationDialog.tsx`      |

So the E4 note above is right that `MainLayout.tsx` and `Diary.tsx` are the permanent web conflict
zone, and **the E6 note that first stood here — calling `ConfirmationDialog.tsx` "the one to watch" —
was wrong.** It is the _coldest_ file the fork has touched on the web: six upstream commits in its
entire history, one in the last six months. The reasoning behind that claim was not wrong, only
mis-weighted — that one recent commit (`03e5d1451`, 2026-05-28) did land exactly where the fork now
edits, adding the secondary-action button to the footer. Being a shared primitive with six callers
makes a conflict there _consequential_; it does not make it _likely_, and the note conflated the two.
The honest version: low probability, small blast radius (10 scattered hunks in a 74-line file — a
conflict is effectively a re-apply by hand, and the whole file is 74 lines), and a fix upstream would
plausibly make itself. This fork does not PR out, so convergence is the only way it ever stops being
a fork edit.
