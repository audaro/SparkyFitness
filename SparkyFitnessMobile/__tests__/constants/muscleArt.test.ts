import { MUSCLES, type Muscle } from '@workspace/shared';

import {
  BODY_PATHS,
  BODY_VIEWS,
  BODY_VIEW_ASPECT,
  MUSCLES_ON_BODY,
  type BodyView,
} from '../../src/constants/muscleArt.generated';
import { MUSCLE_TILES, tileForMuscle } from '../../src/constants/muscleTiles';
import { flattenPath, polygonArea, pointInPolygon } from '../helpers/svgPathGeometry';

const VIEWS: BodyView[] = ['front', 'back'];

const box = (view: BodyView) => {
  const [minX, minY, width, height] = BODY_VIEWS[view].viewBox.split(' ').map(Number);
  return { minX, minY, width, height };
};

const pathsOn = (view: BodyView) => BODY_PATHS.filter((path) => path.view === view);

const musclesOn = (view: BodyView) =>
  new Set(pathsOn(view).flatMap((path) => (path.kind === 'muscle' ? [path.muscle] : [])));

describe('the figure', () => {
  test('has a silhouette, labelled muscles and outline detail, on both views', () => {
    for (const view of VIEWS) {
      const kinds = new Set(pathsOn(view).map((path) => path.kind));

      expect(kinds).toEqual(new Set(['silhouette', 'muscle', 'detail']));
    }
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

  test("each view's viewBox contains its whole figure", () => {
    // A path outside the box renders off-screen — invisible, and untappable.
    // The two boxes are also the same size, so flipping the view does not
    // resize the body under the user's finger.
    for (const view of VIEWS) {
      const canvas = box(view);
      for (const path of pathsOn(view)) {
        const points = flattenPath(path.d);

        expect(Math.min(...points.map((point) => point.x))).toBeGreaterThanOrEqual(canvas.minX);
        expect(Math.max(...points.map((point) => point.x))).toBeLessThanOrEqual(
          canvas.minX + canvas.width,
        );
        expect(Math.min(...points.map((point) => point.y))).toBeGreaterThanOrEqual(canvas.minY);
        expect(Math.max(...points.map((point) => point.y))).toBeLessThanOrEqual(
          canvas.minY + canvas.height,
        );
      }
    }
  });

  test('both views are the same shape, which is the aspect the map draws into', () => {
    const [front, back] = VIEWS.map(box);

    expect(front.width).toBe(back.width);
    expect(front.height).toBe(back.height);
    expect(BODY_VIEW_ASPECT).toBeCloseTo(front.width / front.height, 5);
  });
});

describe('coverage', () => {
  test('every canonical muscle has at least one region', () => {
    // The whole point of the hand-authored shapes: a muscle with no region
    // cannot be targeted at all, and nothing else would notice.
    const drawn = new Set(
      BODY_PATHS.flatMap((path) => (path.kind === 'muscle' ? [path.muscle] : [])),
    );

    expect([...drawn].sort()).toEqual([...MUSCLES].sort());
  });

  test('MUSCLES_ON_BODY matches what BODY_PATHS actually contains', () => {
    // The exported list and the paths are generated from one pass, but nothing
    // else would notice them drifting apart.
    const drawn = new Set(
      BODY_PATHS.flatMap((path) => (path.kind === 'muscle' ? [path.muscle] : [])),
    );

    expect([...MUSCLES_ON_BODY].sort()).toEqual([...drawn].sort());
  });

  test('the relabelled regions are the two paths each that the illustration draws', () => {
    // Both overrides are keyed on an exact `d` string. If upstream redraws the
    // figure they stop matching, and `pnpm run muscle-art:check` — which
    // `validate` runs — fails rather than the muscle quietly vanishing.
    const count = (muscle: Muscle) =>
      BODY_PATHS.filter((path) => path.kind === 'muscle' && path.muscle === muscle).length;

    expect(count('lats')).toBe(2);
    expect(count('middle back')).toBe(2);
  });

  test('the relabelled regions are on the back figure, where the illustration draws them', () => {
    // `lats` and `middle back` exist only because two upstream regions are
    // relabelled: the wings under the armpits (classed `obliques`, which folds
    // into `abdominals` — so tapping a lat used to select Abs) and the slabs
    // down the spine (classed `traps`). If an override stopped matching, the
    // muscle would quietly vanish from the figure.
    expect(musclesOn('back')).toContain('lats');
    expect(musclesOn('back')).toContain('middle back');
    expect(musclesOn('front')).not.toContain('lats');

    // ...and relabelling the spine slabs must not have left the trapezius
    // regionless: it keeps the neck yoke behind and the two wedges in front.
    expect(musclesOn('back')).toContain('traps');
    expect(musclesOn('front')).toContain('traps');
  });

  test('the hand-authored regions are the three the illustration has no geometry for', () => {
    const authored = new Set(
      BODY_PATHS.flatMap((path) => (path.kind === 'muscle' && path.authored ? [path.muscle] : [])),
    );

    expect([...authored].sort()).toEqual(['abductors', 'adductors', 'neck']);
  });

  test('no authored region escapes the silhouette it is drawn on', () => {
    // A blob outside the body reads as a bug, and it is the one thing about a
    // hand-placed shape that a test can actually judge. The generator refuses
    // to emit one; this checks the committed file, which is what ships.
    for (const view of VIEWS) {
      const silhouette = pathsOn(view).find((path) => path.kind === 'silhouette');
      const outline = flattenPath(silhouette!.d);

      for (const path of pathsOn(view)) {
        if (path.kind !== 'muscle' || !path.authored) continue;
        for (const point of flattenPath(path.d)) {
          expect({ view, muscle: path.muscle, inside: pointInPolygon(outline, point) }).toEqual({
            view,
            muscle: path.muscle,
            inside: true,
          });
        }
      }
    }
  });
});

describe('as a set of tap targets', () => {
  /**
   * What a unit of the viewBox is worth on a small phone: a 360pt-wide screen,
   * less the picker's own 16pt of padding either side.
   */
  const PT_PER_UNIT = (360 - 32) / box('front').width;
  /**
   * Comfortably under the 44pt-square minimum, because these are irregular
   * shapes rather than buttons and the readout beneath the figure means a
   * mistap never has to be undone by tapping the same small shape again. It is
   * a floor against a region shrinking, not a claim that every one is generous.
   */
  const MIN_TAP_AREA_PT2 = 34 * 34;

  test('every muscle is a real target on at least one view', () => {
    // "At least one" and not "both": the trapezius is a pair of small wedges in
    // front and a broad yoke behind, and it is the yoke you are meant to hit.
    for (const muscle of MUSCLES) {
      const best = Math.max(
        ...VIEWS.map((view) =>
          pathsOn(view)
            .filter((path) => path.kind === 'muscle' && path.muscle === muscle)
            .reduce((total, path) => total + polygonArea(flattenPath(path.d)), 0),
        ),
      );

      expect({ muscle, area: Math.round(best * PT_PER_UNIT * PT_PER_UNIT) }).toEqual({
        muscle,
        area: expect.any(Number),
      });
      expect(best * PT_PER_UNIT * PT_PER_UNIT).toBeGreaterThan(MIN_TAP_AREA_PT2);
    }
  });
});

describe('tiles against the figure', () => {
  test('every muscle maps back to a tile', () => {
    // The body map selects muscles while the screen holds tiles, so a muscle
    // with no tile would be tappable and then silently dropped.
    for (const muscle of MUSCLES) {
      const tile = tileForMuscle(muscle);

      expect(tile).toBeDefined();
      expect(tile!.muscles).toContain(muscle);
    }
  });

  test('no tile is half-drawn', () => {
    // Back is the one tile covering two muscles, and tapping either lights both
    // — which is only honest because both are drawn. A tile with one muscle on
    // the figure and one off would highlight half of what it sends.
    const drawn = new Set<Muscle>(MUSCLES_ON_BODY);
    for (const tile of MUSCLE_TILES) {
      const on = tile.muscles.filter((muscle) => drawn.has(muscle));

      expect({ tile: tile.id, on: on.length }).toEqual({ tile: tile.id, on: tile.muscles.length });
    }
  });
});
