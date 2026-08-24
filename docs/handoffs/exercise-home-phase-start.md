# Handoff — Exercise home & muscle targeting: starting point

Branch `feat/ai-coach`. Written 2026-08-24.

## The plan lives outside this repo

**`~/fitness/EXERCISE-HOME-BLUEPRINT.md`** — an agent-executable blueprint of 23 numbered tasks
across five phases. Read it before starting any of this work. It sits beside
`~/fitness/FITBOD-BLUEPRINT.md` (W1–W8), which built the recommendation engine this work surfaces.

Both are outside the checkout deliberately: they are planning documents, not repo content. This file
exists so they are discoverable from inside the repo.

## What shipped immediately before this

Weekly set targets — working sets per training group against a weekly goal, Sunday–Saturday.

- `b1049410` — the feature: shared engine, `coach_profiles.weekly_set_targets`, `/api/weekly-set-targets`, mobile screen with a Skia hexagon ring
- `c949fd5a` — review fixes: stricter set counting, query bounded at today, atomic JSONB merge, owner-only route
- `19340c52` — review fixes: session-scoped completion test, mobile save-race reconciliation

Gate status at `19340c52`: server `pnpm run validate` clean, `pnpm test` **4113 passed / 2 skipped**;
mobile validate clean, jest **5490 passed / 1 failed** (the known Pacific-timezone sleep flake, which
fails on a clean tree — see the blueprint's "Known pre-existing failures").

## What this project is

Two problems with one root cause. Exercise features are spread across **four** mobile tabs
(`UpNextCard` on Dashboard, `ExerciseSummary` on Diary, Exercises + presets under Library, gym
profiles + weekly targets + exercise packs under Settings → Workout Settings). There is no exercise
home, so each new feature lands next to whichever sibling it most resembles — which is why weekly set
targets ended up in Settings.

The blueprint gives them a home (Phase A), then adds the one capability the engine never had:
**client-chosen target muscles** (Phase B). Phases C–E build the muscle grid, the Swap sheet, and web
parity.

## Exact next step

Blueprint task **A0** (read-only: the mobile navigation contract) or task **B1**. A and B are
independent; **B is the smaller and safer starting point.**

## Open risks

- **Task C2 needs a human.** Five of the 17 canonical muscles (`lats`, `middle back`, `abductors`,
  `adductors`, `neck`) have no path in `SparkyFitnessFrontend/public/images/muscle-male.svg`. The
  blueprint's decision D5 makes this block nothing — tiles fall back to a labelled colour swatch.
- **Tab changes touch five files in lockstep** across two runtime rendering paths, gated by
  `__tests__/navigation/nativeHeaderContract.test.ts`. Blueprint task A0 exists for this.
- **Sharing is deferred** and is on the blueprint's STOP list. Do not start it.
