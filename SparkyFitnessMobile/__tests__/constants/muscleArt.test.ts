import { MUSCLES, type Muscle } from '@workspace/shared';

import {
  BODY_PATHS,
  BODY_VIEW_BOX,
  MUSCLES_ON_BODY,
} from '../../src/constants/muscleArt.generated';
import { MUSCLE_TILES, TILES_OFF_BODY, tileForMuscle } from '../../src/constants/muscleTiles';

const canvas = (() => {
  const [minX, minY, width, height] = BODY_VIEW_BOX.split(' ').map(Number);
  return { minX, minY, width, height };
})();

describe('the figure', () => {
  test('has a silhouette, labelled muscles and outline detail', () => {
    const kinds = new Set(BODY_PATHS.map((path) => path.kind));

    expect(kinds).toEqual(new Set(['silhouette', 'muscle', 'detail']));
  });

  test('draws the silhouette before any muscle, and detail after every one', () => {
    // The array is rendered in order, so this ordering *is* the layering: the
    // body under the muscles, the outline over them. Sorting it or filtering by
    // kind while rendering would put muscles on top of the head and hands.
    const firstMuscle = BODY_PATHS.findIndex((path) => path.kind === 'muscle');
    const lastMuscle = BODY_PATHS.map((path) => path.kind).lastIndexOf('muscle');
    const firstSilhouette = BODY_PATHS.findIndex((path) => path.kind === 'silhouette');
    const lastDetail = BODY_PATHS.map((path) => path.kind).lastIndexOf('detail');

    expect(firstSilhouette).toBeLessThan(firstMuscle);
    expect(lastDetail).toBeGreaterThan(lastMuscle);
  });

  test('every path is absolute, so it is safe to render unshifted', () => {
    for (const path of BODY_PATHS) {
      expect(path.d).toMatch(/^M/);
      expect(path.d.replace(/e[-+]?\d+/gi, '')).not.toMatch(/[a-z]/);
    }
  });

  test('every coordinate falls inside the declared viewBox', () => {
    // A path outside the box renders off-screen — invisible, and untappable.
    for (const path of BODY_PATHS) {
      const numbers = path.d.match(/-?\d*\.?\d+/g)!.map(Number);
      const xs = numbers.filter((_, index) => index % 2 === 0);
      const ys = numbers.filter((_, index) => index % 2 === 1);

      expect(Math.min(...xs)).toBeGreaterThanOrEqual(canvas.minX);
      expect(Math.max(...xs)).toBeLessThanOrEqual(canvas.minX + canvas.width);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(canvas.minY);
      expect(Math.max(...ys)).toBeLessThanOrEqual(canvas.minY + canvas.height);
    }
  });
});

describe('coverage', () => {
  // What the illustration actually draws — not a wish list. It fails if a
  // regeneration silently drops one.
  const ON_BODY: Muscle[] = [
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

  const OFF_BODY: Muscle[] = ['abductors', 'adductors', 'lats', 'middle back', 'neck'];

  test('the figure draws exactly the muscles it claims to', () => {
    expect([...MUSCLES_ON_BODY].sort()).toEqual([...ON_BODY].sort());
  });

  test('MUSCLES_ON_BODY matches what BODY_PATHS actually contains', () => {
    // The exported list and the paths are generated from one pass, but nothing
    // else would notice them drifting apart.
    const drawn = new Set(
      BODY_PATHS.flatMap((path) => (path.kind === 'muscle' ? [path.muscle] : [])),
    );

    expect([...drawn].sort()).toEqual([...MUSCLES_ON_BODY].sort());
  });

  test('on-figure and off-figure muscles partition the vocabulary', () => {
    // If upstream adds a canonical muscle it lands in neither, and this fails
    // rather than the muscle quietly becoming unpickable.
    expect([...ON_BODY, ...OFF_BODY].sort()).toEqual([...MUSCLES].sort());
  });

  test('every canonical muscle is reachable — on the figure or as a chip', () => {
    const reachable = [
      ...MUSCLES_ON_BODY,
      ...TILES_OFF_BODY.flatMap((tile) => tile.muscles),
    ];

    expect([...reachable].sort()).toEqual([...MUSCLES].sort());
  });
});

describe('tiles against the figure', () => {
  test('no tile is half-drawn', () => {
    // A tile with one muscle on the figure and one off would be tappable on the
    // body *and* listed as missing from it, and picking either would mean
    // something different from picking the other.
    for (const tile of MUSCLE_TILES) {
      const on = tile.muscles.filter((muscle) => MUSCLES_ON_BODY.includes(muscle));

      expect(on.length === 0 || on.length === tile.muscles.length).toBe(true);
    }
  });

  test('the chips are exactly the tiles with no region', () => {
    expect(TILES_OFF_BODY.map((tile) => tile.id).sort()).toEqual(
      ['abductors', 'adductors', 'back', 'neck'].sort(),
    );
  });

  test('Back is a chip, because the figure draws neither muscle it covers', () => {
    // The most visible gap: it is picked often, and both `lats` and
    // `middle back` are absent from the illustration.
    const back = MUSCLE_TILES.find((tile) => tile.id === 'back');

    expect(back?.muscles).toEqual(['lats', 'middle back']);
    expect(TILES_OFF_BODY).toContain(back);
  });

  test('every muscle on the figure maps back to its own tile', () => {
    // The body map selects muscles while the screen holds tiles, so a muscle
    // with no tile would be tappable and then silently dropped.
    for (const muscle of MUSCLES_ON_BODY) {
      const tile = tileForMuscle(muscle);

      expect(tile).toBeDefined();
      expect(tile!.muscles).toContain(muscle);
    }
  });
});
