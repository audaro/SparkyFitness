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
| `SparkyFitnessFrontend/` | `pnpm test`         | **1051 passed, 108 suites**   |

Baseline before E4 was 1045 passed / 105 suites; E4 adds two suites (6 tests) plus two cases on
`dashboardLayout.test.ts`.

## Exact next step

**The blueprint is finished.** There is no E5. What is left is the standing backlog below; nothing
in it blocks anything else, and none of it is on a critical path.

## Open items

Two the reviewer of this phase should see first, because they are the honest gaps in "web parity":

- **There is no start-workout button on the web Up Next card.** The card renders the generated
  workout and can regenerate it, but cannot begin it. What is missing is a
  `WorkoutRecommendationPayload → WorkoutPlaybackExerciseDraft[]` mapping — the recommendation
  analogue of `buildWorkoutPlaybackDraft`, which today only maps a preset.
  **`preset_id` is not the blocker it looks like.** It is on `WorkoutPlaybackDraft` as a required
  `string`, but grep says it is written once (`workoutPlayback.ts:335`) and read once, in
  `isWorkoutPlaybackDraft`'s type guard — nothing looks a preset up by it, and the draft is keyed in
  localStorage by `entry_date`. A recommendation's own UUID satisfies it. Do not build a
  synthetic-preset story to get past this field; if it should be nullable for a recommendation-sourced
  draft, widen the type and the guard together.
  **Mobile's mapping is not liftable as-is either.** `buildRecommendationDraftExercises`
  (`SparkyFitnessMobile/src/utils/workoutSession.ts`) targets `WorkoutDraftExercise`, the _preset
  form_ type: display strings converted to the user's units, mobile's set-type vocabulary via
  `CANONICAL_TO_MOBILE_SET_TYPE`, and mobile client ids. Web's playback draft holds numbers in
  canonical units and has no client ids. It is a useful reference for the field-by-field decisions
  (cardio zeroes `rest_time`, `supersetGroup` is never stored on a payload) and a poor donor for the
  code. So: a web-local mapping beside `buildWorkoutPlaybackDraft`, not a `shared/` extraction —
  which makes this a well-scoped task, not the multi-day one an earlier draft of this doc implied.
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

Worth knowing before the next upstream sync. Until now the fork's conflict surface was mobile-only
(16 files on the 341-commit merge of 2026-08-24, all of them files the fork edited in place or
deleted). E4 opens a **second permanent conflict zone on the web**: `layouts/MainLayout.tsx` holds
both nav arrays and upstream edits them regularly (the cycle and medications conditionals are
recent), and `pages/Diary/Diary.tsx`'s widget registry is likewise upstream's. Everything else E4
added is a new file, which historically has cost nothing.

The tab lists were **not** extracted into a helper, on purpose. Doing so would read as cleaner and
would make every future upstream nav change conflict against an array that no longer exists in the
file they edited. In-place edits are the cheaper trade here.
