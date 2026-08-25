/**
 * The regions the illustration does not draw, drawn by hand.
 *
 * `SparkyFitnessFrontend/public/images/muscle-male.svg` labels twelve of the
 * seventeen canonical muscles, and two more are there under the wrong name
 * (see `D_OVERRIDES` in `build.mjs`). Three are genuinely absent: the figure
 * has no separate inner-thigh mass, no outer-hip mass, and a bare silhouette
 * for the front of the neck. Every one of those was checked path by path
 * before it was accepted as missing.
 *
 * They live in their own file, and not in the generator, so that regenerating
 * against a redrawn upstream SVG can never silently drop them: the merge is an
 * input the generator reads, and it throws if a shape stops landing inside the
 * silhouette.
 *
 * These are deliberately plain — a handful of curves each, placed against a
 * rendered figure (`pnpm run muscle-art:render`) rather than reasoned about
 * from coordinates. They are tap targets that read as the right part of the
 * body, not anatomical illustration, and they are drawn generously rather than
 * strictly: the phase-4 readout is what makes an imprecise tap recoverable, and
 * a target you cannot hit is worse than one a millimetre wide of the belly.
 *
 * Coordinates are in the illustration's own space, so both figures are here:
 * the front one spans x 1–229, the back one x 288–534. Everything mirrors
 * about the figure's midline — x 115 in front, x 411.5 behind.
 */

/**
 * @typedef {object} AuthoredShape
 * @property {string} muscle A canonical muscle from `MUSCLES`.
 * @property {string} d An absolute SVG path, in the illustration's coordinates.
 * @property {string} note Why it is placed where it is.
 */

/** @type {readonly AuthoredShape[]} */
export const AUTHORED_SHAPES = [
  {
    muscle: 'neck',
    note: 'Front of the neck, between the jaw and the sternal notch. It tucks '
      + 'behind the two upper-trap wedges the illustration already draws, so '
      + 'the trapezius keeps its own region either side of it.',
    d:
      'M 99,59 C 99,57 101,56 103,56 L 127,56 C 129,56 131,57 131,59 '
      + 'C 131,66 130,71 128,75 C 125,81 121,85 115,87 '
      + 'C 109,85 105,81 102,75 C 100,71 99,66 99,59 Z',
  },
  {
    muscle: 'adductors',
    note: 'Inner thigh, left leg. The quads are drawn full-width with no '
      + 'separate inner mass, so this sits over their medial edge, from the '
      + 'groin down to mid-thigh.',
    d:
      'M 99,215 C 103,212 106.5,214 107.5,220 C 108.5,230 108,244 106,255 '
      + 'C 104,265 102,271 99,273 C 95,267 93,252 93.5,238 '
      + 'C 94,227 96,219 99,215 Z',
  },
  {
    muscle: 'adductors',
    note: 'Inner thigh, right leg — the mirror of the left about x 115.',
    d:
      'M 131,215 C 127,212 123.5,214 122.5,220 C 121.5,230 122,244 124,255 '
      + 'C 126,265 128,271 131,273 C 135,267 137,252 136.5,238 '
      + 'C 136,227 134,219 131,215 Z',
  },
  {
    muscle: 'abductors',
    note: 'Outer hip, left side of the back figure. The strip lateral to the '
      + 'glute is only a few units wide, so this overlaps the glute\'s upper-'
      + 'outer corner instead — which is where gluteus medius actually is.',
    d:
      'M 371,194 C 373,189 377,186 383,187 C 388,188 391,192 391,198 '
      + 'C 391,205 388,210 383,213 C 378,215 373,214 371,210 '
      + 'C 369,205 369,199 371,194 Z',
  },
  {
    muscle: 'abductors',
    note: 'Outer hip, right side — the mirror of the left about x 411.5.',
    d:
      'M 452,194 C 450,189 446,186 440,187 C 435,188 432,192 432,198 '
      + 'C 432,205 435,210 440,213 C 445,215 450,214 452,210 '
      + 'C 454,205 454,199 452,194 Z',
  },
];
