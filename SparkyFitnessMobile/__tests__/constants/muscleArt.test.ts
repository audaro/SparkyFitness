import { MUSCLES, type Muscle } from '@workspace/shared';

import { MUSCLE_ART } from '../../src/constants/muscleArt.generated';
import { MUSCLE_TILES, artForTile } from '../../src/constants/muscleTiles';

/**
 * The illustration's own canvas, `SparkyFitnessFrontend/public/images/muscle-male.svg`.
 * Every generated viewBox is a window onto it, so nothing should fall far outside.
 */
const CANVAS = { width: 535, height: 462 };

const box = (viewBox: string) => {
  const [minX, minY, width, height] = viewBox.split(' ').map(Number);
  return { minX, minY, width, height };
};

describe('MUSCLE_ART coverage', () => {
  // The illustration is upstream's and knows twelve of the seventeen canonical
  // muscles. This is not a wish list — it is what the art actually contains, and
  // it fails if a regeneration silently drops one.
  const COVERED: Muscle[] = [
    'abdominals',
    'biceps',
    'calves',
    'chest',
    'forearms',
    'glutes',
    'hamstrings',
    'lower back',
    'quadriceps',
    'shoulders',
    'traps',
    'triceps',
  ];

  const UNCOVERED: Muscle[] = ['abductors', 'adductors', 'lats', 'middle back', 'neck'];

  test('draws exactly the muscles the illustration labels', () => {
    expect(Object.keys(MUSCLE_ART).sort()).toEqual([...COVERED].sort());
  });

  test('the covered and uncovered sets partition the canonical vocabulary', () => {
    // Guards the count claim in every comment about this: if upstream adds a
    // canonical muscle, it lands in neither list and this fails.
    expect([...COVERED, ...UNCOVERED].sort()).toEqual([...MUSCLES].sort());
  });

  test('nothing appears in both', () => {
    for (const muscle of UNCOVERED) {
      expect(MUSCLE_ART[muscle]).toBeUndefined();
    }
  });
});

describe('MUSCLE_ART geometry', () => {
  test.each(Object.entries(MUSCLE_ART))('%s has a square, on-canvas viewBox', (_muscle, art) => {
    const { minX, minY, width, height } = box(art!.viewBox);

    // Square because the tile is square and react-native-svg letterboxes a
    // mismatched viewBox — a tall narrow box would draw the muscle as a sliver.
    expect(width).toBeCloseTo(height, 2);
    expect(width).toBeGreaterThan(0);

    // A box wider than the canvas means the generator measured both bodies at
    // once and framed two half-figures instead of one muscle. That is exactly
    // what the first version of this did.
    expect(width).toBeLessThan(CANVAS.width);
    expect(minX).toBeGreaterThan(-CANVAS.width);
    expect(minY).toBeGreaterThan(-CANVAS.height);
  });

  test.each(Object.entries(MUSCLE_ART))('%s is framed so none of it is clipped', (_muscle, art) => {
    // The invariant squareness alone does not give: every coordinate the path
    // draws has to fall inside the window the tile renders it through. Sizing
    // the box off width alone leaves it square and still cuts the bottom off
    // anything taller than it is wide — which is most muscles.
    const numbers = art!.d.match(/-?\d*\.?\d+/g)!.map(Number);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    const { minX, minY, width, height } = box(art!.viewBox);

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(minX);
    expect(Math.max(...xs)).toBeLessThanOrEqual(minX + width);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(minY);
    expect(Math.max(...ys)).toBeLessThanOrEqual(minY + height);
  });

  test.each(Object.entries(MUSCLE_ART))('%s has absolute path data', (_muscle, art) => {
    // The generator's bounding box is min/max over every number in the string,
    // which is only sound while the commands are absolute.
    expect(art!.d).toMatch(/^M/);
    expect(art!.d.replace(/e[-+]?\d+/gi, '')).not.toMatch(/[a-z]/);
  });

  test.each(Object.entries(MUSCLE_ART))('%s sits on one side of the seam', (_muscle, art) => {
    // Each entry comes from one of the two bodies, never a mix of both.
    const { minX, width } = box(art!.viewBox);
    const seam = CANVAS.width / 2;
    const centre = minX + width / 2;

    expect(art!.view).toBe(centre < seam ? 'front' : 'back');
  });
});

describe('the view each muscle is drawn from', () => {
  // The generator picks this with a heuristic — the view drawing the muscle in
  // more pieces, ties to the front. Pinned per muscle so a regeneration that
  // flips one fails here. Measuring by area instead put abdominals on the back,
  // because obliques wrap further round than the abs reach across the front.
  const EXPECTED: Record<string, 'front' | 'back'> = {
    abdominals: 'front',
    biceps: 'front',
    chest: 'front',
    forearms: 'front',
    quadriceps: 'front',
    shoulders: 'front',
    calves: 'back',
    glutes: 'back',
    hamstrings: 'back',
    'lower back': 'back',
    traps: 'back',
    triceps: 'back',
  };

  test.each(Object.entries(EXPECTED))('%s is drawn from the %s', (muscle, view) => {
    expect(MUSCLE_ART[muscle as Muscle]?.view).toBe(view);
  });
});

describe('artForTile', () => {
  test('every tile either has art or is one of the five without it', () => {
    const withoutArt = MUSCLE_TILES.filter((tile) => !artForTile(tile)).map((tile) => tile.id);

    expect(withoutArt.sort()).toEqual(['abductors', 'adductors', 'back', 'neck'].sort());
  });

  test('Back has no art, because neither muscle it covers is drawn', () => {
    // The one multi-muscle tile, and the most visible gap in the grid: `lats`
    // and `middle back` are both missing from the illustration.
    const back = MUSCLE_TILES.find((tile) => tile.id === 'back');

    expect(back?.muscles).toEqual(['lats', 'middle back']);
    expect(artForTile(back!)).toBeUndefined();
  });

  test('a tile resolves to its own muscle, not a neighbour', () => {
    const chest = MUSCLE_TILES.find((tile) => tile.id === 'chest');

    expect(artForTile(chest!)).toBe(MUSCLE_ART.chest);
  });
});
