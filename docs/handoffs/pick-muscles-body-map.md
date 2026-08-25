# Handoff — Pick Muscles: full-vocabulary body map

Branch `feat/ai-coach`. Previous step: `docs/handoffs/workout-playback-entry-points.md`, whose last
mobile commit (`f2fd45d80`) turned Pick Muscles into a tappable anatomical figure with a row of chips
beneath it for the muscles the illustration does not draw.

> **Shipped 2026-08-24.** All five phases below are done; what actually landed, and where it
> departed from this plan, is recorded in `docs/handoffs/pick-muscles-body-map-shipped.md`. Keep
> reading this file for the *why* behind each phase — it is the design rationale — but treat the
> other one as the description of the code.

This was a **plan, not a record** when it was written — nothing below had shipped. It closes three
gaps left by that commit: the chips, an invisible selection treatment, and the absence of any
readout naming what the user has picked.

Mobile-only (`SparkyFitnessMobile/`). Nothing on the server, the frontend, or in `shared/` changes.
The illustration itself (`SparkyFitnessFrontend/public/images/muscle-male.svg`) is upstream's and is
read, never edited.

## What the research established

The figure was rendered and inspected region by region rather than reasoned about from coordinates.
Four findings, in descending order of consequence:

1. **A live mis-mapping.** The two large wings under the armpits on the back figure are classed
   `obliques` in the source. They are the **lats** — the shape is unmistakable once rendered. The
   generator folds `obliques → abdominals`, so **tapping a lat currently selects Abs.** This is a bug
   in what shipped, not merely a gap in coverage.
2. **Two of the five missing muscles already have artwork**, mislabelled for this repo's vocabulary:
   - `lats` — the back `obliques` wings.
   - `middle back` — the two dark slabs down the mid-spine, currently `traps`. That region is
     mid/lower trapezius plus rhomboids, which is what "middle back" means in exercise taxonomy.
     `traps` keeps the neck yoke and the two front upper-trap wedges, so it is not left regionless.

   The lower lateral paths stay `abdominals`; those genuinely are the flank.

3. **Three muscles have no geometry at all** — `neck`, `abductors`, `adductors`. Checked path by
   path: the quads span the full width of the thigh with no separate inner mass, the hamstrings
   likewise, and the front neck is bare silhouette. There is nothing to relabel.
4. **Scale is the real defect.** Both figures render side by side, so on a ~360pt-wide phone each
   body is ~180pt across and most muscles are 10–20pt tap targets — below the 44pt minimum. It is
   also why the current selection styling is imperceptible: `strokeWidth={2}` in a 535-unit viewBox
   at that scale is well under a point, and `opacity` 0.85 against 1.0 is not a visible difference.

## The five phases

Ordered deliberately: phase 1 is cheap and multiplies the value of every phase after it. If only one
phase is done, it should be that one.

### 1. Front/back toggle

A segmented control above the figure, rendering one view at a time by swapping the `viewBox` between
`"0 0 240 462"` (front) and `"288 0 247 462"` (back). Both numbers come from the measured silhouette
bounds — no geometry work. This roughly doubles every tap target and every visual cue, which is what
makes phases 2 and 3 legible rather than merely present. Selection state is shared across views; a
muscle simply appears on whichever view draws it.

### 2. All seventeen muscles, no chips

In `scripts/generate-muscle-art.mjs`:

- Remap the back `obliques` wings to `lats` and the two mid-spine `traps` slabs to `middle back`.
- **Key every override on the exact `d` string, never on a path index.** An upstream reorder would
  silently re-point index-keyed overrides at the wrong muscle. Throw if an override finds no match.
- Merge three hand-authored shapes from a **separate input file**, so regenerating against a new
  upstream SVG can never silently drop them: a neck column on the front figure, an outer-hip lozenge
  per side on the back, an inner-thigh sliver per leg on the front. Simple rounded blobs — a handful
  of curve commands each, not anatomical illustration.
- Throw if any authored shape falls outside the silhouette, and throw if any of the 17 canonical
  muscles ends up with no region.

Then delete `TILES_OFF_BODY`, the chips row in `PickMusclesScreen`, and the on/off-body partition
assertions in `__tests__/constants/muscleArt.test.ts`. With full coverage they are dead branches, and
a dead branch left in place is how the next session inherits a wrong mental model.

### 3. A selection you cannot miss

Today fill carries recovery and stroke carries selection, and at the shipped scale both signals are
lost. Move the **precise** recovery value into the phase-4 readout and let fill do what fill is good
at:

- Unselected: recovery tone at ~0.45 opacity — reads as anatomy.
- Selected: full-strength accent fill at opacity 1, plus a halo — the same paths redrawn beneath with
  a thick, low-opacity accent stroke. That is the cheapest way to get a glow without a path union,
  which SVG cannot do natively.
- Stroke width 3–4 in viewBox units, `strokeLinejoin="round"`.
- Dim the silhouette and outline detail slightly whenever anything is selected, so the picks lift off
  the body.

No information is lost: hue still carries recovery, and the exact percentage moves to text where it
can actually be read.

### 4. A readout naming what is picked

Below the figure: a `Selected (n)` heading and one row per pick — `Chest · 100% recovered` — each
tappable to remove, with an empty state (`Tap a muscle to target it.`).

This is not the chip row returning. Those chips were **pickers** for unreachable muscles; this is a
**readout** of what is chosen. It also quietly fixes two things: it gives a way to undo a mistap
without hunting a small shape, and it is where the recovery percentages live now that fill carries
selection.

### 5. Verify visually, not only by test

This is the phase that makes the rest stable, and it is newly possible: **Quick Look renders SVG**, so
the generated output can be inspected directly rather than inferred.

```bash
qlmanage -t -s 1600 -o <output-dir> <file.svg>
```

Script the render of the generated paths to PNG and inspect each view with a selection applied.
Every hand-authored shape gets eyeballed before it lands. Alongside that, assert in tests:

- all 17 canonical muscles have at least one path;
- no authored path escapes the silhouette;
- every override matched (the generator throws, but pin it);
- each view's `viewBox` contains its whole figure;
- tap targets meet a minimum area threshold at the rendered scale.

## Also fix while in here

`src/constants/muscleTiles.ts` has two doc comments left above the wrong functions by the last edit —
the "tiles the body map cannot offer" block sits above `tileForMuscle`, and the `musclesForTiles`
block is stranded above both. One of them describes machinery phase 2 deletes outright.

## Open risks

- **The three authored shapes are the only judgment call.** They are not the illustrator's geometry,
  so a plain lozenge will sit beside hand-drawn muscle bellies and look slightly less crafted. The
  screenshot loop in phase 5 is what makes that iterable rather than a guess. It is still the one
  place this stops being mechanical.
- **Thin regions stay marginal targets** even after phase 1 — the neck column especially. The phase-4
  readout is the mitigation (removal never requires a precise tap), and the authored shapes can be
  drawn generously rather than strictly anatomically.
- **`react-native-svg` 15.15.4 passes only `accessible` and `accessibilityLabel` through to a
  `Path`** — no role, no checked state. Selection and recovery must continue to be spoken inside the
  label text, as `MuscleBodyMap` already does.

## Gate

Nothing to gate yet — no code has changed. When the work lands, from `SparkyFitnessMobile/`:

```bash
pnpm run validate
pnpm exec jest --watchman=false --runInBand --coverage=false
```

Do not run prettier on mobile files. The illustration is upstream's: regenerate, never hand-edit
`src/constants/muscleArt.generated.ts`.
