# Handoff — Pick Muscles: full-vocabulary body map (shipped)

Branch `feat/ai-coach`. This is the **record** for `docs/handoffs/pick-muscles-body-map.md`, which
was the plan. All five of its phases shipped on 2026-08-24 in one commit. Read the plan for the
*why*; read this for what the code actually does and where it diverged.

Mobile-only (`SparkyFitnessMobile/`). Nothing on the server, the frontend, or in `shared/` changed.
The upstream illustration (`SparkyFitnessFrontend/public/images/muscle-male.svg`) was read, never
edited.

## What shipped

**Phase 1 — front/back toggle.** A `SegmentedControl` above the figure; `MuscleBodyMap` takes a
`view: BodyView` prop and draws one figure at a time. Selection is shared across views — a muscle
simply appears on whichever figure draws it, and there is a test for a pick surviving the flip.

Divergence from the plan: the plan suggested two hand-measured, differently-sized viewBoxes. The
generator instead emits **two boxes of identical size**, each centred on its own silhouette, so
flipping does not resize the body under the user's finger and `BODY_VIEW_ASPECT` stays a single
number. Both are derived from the measured silhouette bounds, and a test asserts each box contains
its whole figure (flattened curves, not control points).

**Phase 2 — all seventeen muscles, no chips.** The generator gained two fail-loud inputs, both under
`scripts/muscle-art/`:

- `relabelled-paths.mjs` re-labels four upstream paths — the wings under the armpits (upstream classes
  them `obliques`, which folds into `abdominals`, so tapping a lat used to select Abs) become `lats`,
  and the two slabs down the spine (classed `traps`) become `middle back`. **Every override is keyed
  on the exact, whitespace-collapsed `d` string, never a path index.** An override that matches
  nothing throws with a remediation message. `traps` keeps its neck yoke and its two front wedges, so
  relabelling did not leave it regionless.
- `authored-shapes.mjs` holds the five hand-drawn regions the illustration has no geometry for at all:
  a neck column (front), an inner-thigh sliver per leg (front, `adductors`), an outer-hip lozenge per
  side (back, `abductors`). A separate input file, so regeneration can never silently drop them. The
  build throws if any of their flattened points falls outside that figure's silhouette — which it
  did, once, and correctly, while the lozenges were being placed.

The build also throws if any of the 17 canonical muscles ends up with no region, and reads the
canonical list out of `shared/src/constants/exerciseTaxonomy.ts` rather than hardcoding it.
`TILES_OFF_BODY`, the chips row, and the on/off-body partition assertions are deleted.

**Phase 3 — a selection you cannot miss.** Unselected regions: recovery tone at `0.45`. Selected:
accent fill at full strength under a halo — the same path redrawn beneath itself with a `9`-unit
accent stroke at `0.3` opacity, `pointerEvents="none"` so the glow cannot steal taps from the region
next door. The silhouette and the outline detail hold still: they dimmed while anything was selected
in the first version, on the theory that the body should step back for a pick, and what that looked
like on a phone was the figure's face, hands and feet going grey the moment you tapped a muscle.
Nothing in that layer is pickable, so nothing in it should react.

Selected paths also draw their own edge back in, in the silhouette's colour at `1.6` units
(`SEAM_STROKE_WIDTH`). **This illustration has no lines of its own** — what separates the eight
paths of the quads or the segments of the abs is the silhouette showing through the *gaps* between
them, so an opaque fill destroys the anatomy and a pick reads as one flat slab. The first version
shipped with a `3.5`-unit *accent* stroke instead, which made the flatness rather than fixing it:
same colour as the fill, and wide enough to close the very seams it was drawn over. Raising the
`detail` layer does nothing for this — the definition is not in that layer, which is only the head,
hands and body outline.

**Phase 4 — a readout naming what is picked.** Under the figure: `Selected (n)`, one row per pick
reading `Chest · 100% recovered` with the recovery half tinted the same tone the figure fills that
muscle with, a neutral `Remove`, and the empty state `Tap a muscle to target it.` Rows are in tile
order, not tap order, so the list does not reshuffle as picks come and go. Tapping a row removes the
pick.

The rows are **per tile**, not per muscle, because the screen's state is tiles. That matters now
that Back covers two drawn muscles: tapping a lat lights the mid-spine too, and the readout says
`Back · 20% recovered` (worst-of-both, the existing `tileRecovery` rule) — which is the truth of
what the request will carry.

**Phase 5 — verified visually.** `pnpm run muscle-art:render` writes six SVGs (front|back ×
plain|authored|selected) into a gitignored `.muscle-art-render/` and shells `qlmanage -t -s 1600`
to render them. It shares `scripts/muscle-art/build.mjs` with the generator, so what gets eyeballed
is what ships, and it paints the authored regions orange in the `-authored` views. Every authored
shape was looked at and iterated there before it landed; the mis-mapping in phase 2 was confirmed by
painting candidate paths and rendering, not by reading coordinates.

## Where the moving parts live

- `scripts/muscle-art/build.mjs` — the whole derivation, shared by generate/check/render.
- `scripts/muscle-art/relabelled-paths.mjs`, `scripts/muscle-art/authored-shapes.mjs` — the two inputs.
- `scripts/generate-muscle-art.mjs` — formats the result into TS; `--check` re-derives and diffs.
- `scripts/render-muscle-art.mjs` — the visual harness.
- `src/constants/muscleArt.generated.ts` — 101 paths (54 front, 47 back), 17 muscles, 5 authored.
  **Generated. Never hand-edit.**
- `src/components/MuscleBodyMap.tsx`, `src/screens/PickMusclesScreen.tsx`, `src/constants/muscleTiles.ts`.
- `__tests__/helpers/svgPathGeometry.ts` — flatten/area/point-in-polygon, so the suite measures the
  committed artifact rather than trusting the generator that wrote it. Under `__tests__/helpers/`,
  which jest ignores as a test path.

## Gate status

Green as of the commit, from `SparkyFitnessMobile/`:

- `pnpm run validate` — typecheck, lint (`--max-warnings 0`), i18n audit, and the new
  `muscle-art:check`.
- `pnpm exec jest --watchman=false --runInBand --coverage=false` — **376 suites, 6093 tests, all
  passing.**

`validate` now runs `muscle-art:check`, which re-derives the art and fails if the committed file is
not what the illustration produces today. That is the tripwire for both halves going stale: an
override that stopped matching, and a hand-edited or never-regenerated commit.

## Open risks and things worth knowing

- **The freshness check is in `validate`, not in jest, and that is deliberate.** The obvious test —
  import `build.mjs` and compare — cannot work here: `tsconfig` excludes `__tests__`, babel's CJS
  transform leaves `import.meta` undefined, and jest runs without `--experimental-vm-modules`, so
  both the dynamic-import and static-import spellings fail. A build-artifact check belongs in the
  build pipeline anyway. The suite keeps an in-band proxy instead (`lats` and `middle back` pinned at
  two paths each).
- **The authored shapes are hand-placed.** They pass the "inside the silhouette" guard, but no test
  can judge whether a blob looks like a neck. If upstream redraws the illustration, `muscle-art:check`
  will fail, and re-running `muscle-art:generate` is only half the job — `muscle-art:render` and an
  actual look at the PNGs is the other half.
- **Tap-target floor.** `__tests__/constants/muscleArt.test.ts` asserts every muscle exceeds 34×34pt
  of area on its *best* view at a 360pt screen. The tightest is the neck at ~1334pt² against an
  1156pt² floor — real headroom, but not much. Shrinking an authored shape will trip it.
- **The halo is painted per region, in document order**, so a neighbouring muscle drawn later paints
  over part of it. Verified acceptable in the renders; it is the cost of not unioning paths, which
  SVG cannot do.

## Next step

Nothing is outstanding on this milestone. The next piece of recommendation work is unrelated to the
picker; pick it up from `docs/handoffs/workout-playback-entry-points.md`'s own next-step list.
