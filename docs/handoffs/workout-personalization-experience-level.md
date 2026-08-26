# Handoff — Workout personalization: experience level (Phases 1–5)

**Date:** 2026-08-26

## What shipped

The marketing sentence "Builds custom routines tailored to your specific fitness
level, fresh/fatigued muscles, and available gear" is now true end to end:
fitness level was the missing third, and it now shapes generation.

Commits, one per phase (Phases 4a–c share one commit):

1. `a67e74f86` — **Schema + contract.** `coach_profiles.experience_level`
   (nullable TEXT; vocabulary enforced in Zod, not SQL), shared
   `EXPERIENCE_LEVELS` constant, API response/PATCH schemas, repository +
   route, docs tier tables, route tests.
2. `ad4ae688a` — **Wire-through.** Both service seams
   (`generateRecommendation`, `replaceRecommendationExercise`) read
   `coachProfile.experience_level` into `GenerationOptions.experienceLevel`;
   wire-through test pins the seam.
3. `9633421ca` — **Engine.** `levelMatchBonus` already existed; added
   `levelTooAdvancedPenalty` (-2; only when both ranks known, never performed,
   gap ≥ 2), moved `mobilityPenalty` -4 → -6 to preserve the
   stretch-loses-to-real-exercise invariant, and `workingSetCountFor` caps
   beginners at `workingSetsDefault` even for strength. Selection + volume
   only, never progression.
4. `438bba18f` — **Surfaces.** Chat (`sparky_manage_coach_profile` field +
   interview prompt + goldens), web (Up Next footer select, new
   coachProfile api/hook pair), mobile (Exercise-tab Setup row with
   `BottomSheetPicker`, new coachProfileApi + useCoachProfile). All three send
   the lowercase catalog token or explicit null.
5. (this commit) — **Derived fallback.** `deriveExperienceLevel` in
   `shared/src/utils/workoutGeneration.ts` maps distinct non-warm-up training
   days over the trailing year to a level via `derivedIntermediateSessionDays`
   (20) / `derivedExpertSessionDays` (150);
   `getStrengthSessionDayCount` in `workoutRecommendationRepository.ts` does
   the counting. Generate-only, never persisted, stated beats derived, Replace
   deliberately stays level-neutral.

## Gate status

Every commit passed its full gates at commit time:

- Server: `pnpm run validate` + `pnpm test` (4572+ tests)
- Frontend: `pnpm run validate` + `pnpm run test:ci` (1206+ tests)
- Mobile: `pnpm run validate` + `pnpm exec jest --watchman=false --runInBand` (6302+ tests)

## Exact next step

Nothing scheduled. Phase 6 of the blueprint (progression-aware levels, richer
interview) was explicitly deferred to backlog and has no committed design.

## Open risks

- The derived thresholds (20 / 150 days) are educated guesses; they are
  tunables precisely so real usage can retune them. Overshooting only stops
  the too-advanced penalty firing — nothing is prescribed heavier.
- The level vocabulary is `exercises.level`'s own three tokens, exact-match.
  If an import ever introduces new level strings, they rank as unknown (no
  penalty either way) until added to `LEVEL_RANK`.
- The second-opinion reviewer (codex) was down for these turns
  (`.git/second-opinion/last-error.txt`); its silence is not a clean review.
