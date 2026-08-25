/**
 * Generates `src/constants/muscleArt.generated.ts` from the anatomical
 * illustration the web app already renders,
 * `SparkyFitnessFrontend/public/images/muscle-male.svg`.
 *
 * That file is upstream's, so this is a script rather than a hand-pasted
 * constant: when upstream redraws the illustration, re-run this instead of
 * reconciling a copy by hand.
 *
 *   pnpm run muscle-art:generate
 *
 * The illustration labels its paths with a `class` naming the muscle, several
 * paths per muscle (left and right, front and back view). Each tile on the Pick
 * Muscles grid needs those paths as one `d` string plus a viewBox that frames
 * them, which is what this computes.
 *
 * It does NOT cover the whole vocabulary: the illustration knows twelve of the
 * seventeen canonical muscles. The rest are listed in the generated file and
 * their tiles keep drawing a labelled colour block.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(here, '../../SparkyFitnessFrontend/public/images/muscle-male.svg');
const OUT_PATH = resolve(here, '../src/constants/muscleArt.generated.ts');

/**
 * The illustration's class names against this repo's canonical muscle
 * vocabulary (`MUSCLES` in `@workspace/shared`). Two of them are the web app's
 * mapping (`svgClassToSchemaName` in the frontend's `constants/exercises.ts`)
 * and are kept identical on purpose; `obliques` folds into `abdominals` there
 * too, since the vocabulary has no separate member for it.
 */
const SVG_CLASS_TO_MUSCLE = {
  abdominal: 'abdominals',
  obliques: 'abdominals',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lowerback: 'lower back',
  quads: 'quadriceps',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

/** Breathing room around a muscle's bounding box, as a fraction of its size. */
const PADDING = 0.12;

/**
 * The bounding box of an absolute-coordinate path.
 *
 * Every command in this illustration is `M`, `C` or `Z` — all absolute — so
 * every number in the string is a real coordinate and min/max over them is
 * sound. A cubic's control points can sit outside the curve they draw, so the
 * box can come out slightly larger than the ink; it can never come out smaller,
 * which is the direction that would clip the art.
 *
 * Throws on a relative command rather than returning a quietly wrong box: if
 * upstream redraws the illustration with relative paths, this needs a real path
 * parser and should say so instead of emitting nonsense.
 */
function boundingBox(d) {
  const relative = d.match(/[a-z]/g)?.filter((c) => c !== 'e');
  if (relative?.length) {
    throw new Error(
      `Path uses relative commands (${[...new Set(relative)].join(', ')}), ` +
        'which this script cannot measure. Re-export the SVG with absolute ' +
        'coordinates, or replace boundingBox() with a real path parser.',
    );
  }

  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (numbers.length < 2 || numbers.length % 2 !== 0) {
    throw new Error(`Path has ${numbers.length} coordinate numbers, expected an even count above 0.`);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]);
    maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]);
    maxY = Math.max(maxY, numbers[i + 1]);
  }

  // Square the box before padding. A tile is square, and `react-native-svg`
  // letterboxes a mismatched viewBox — so measuring calves (tall and narrow)
  // and handing over its true box would shrink it to a sliver of the tile.
  const size = Math.max(maxX - minX, maxY - minY);
  const pad = size * PADDING;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = size + pad * 2;

  const round = (value) => Math.round(value * 100) / 100;
  return `${round(cx - side / 2)} ${round(cy - side / 2)} ${round(side)} ${round(side)}`;
}

const svg = readFileSync(SVG_PATH, 'utf8');

// Both attribute orders appear in the file, so match the tag and pull each
// attribute out of it rather than assuming class precedes d.
const byMuscle = new Map();
for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
  const className = tag.match(/\bclass="([^"]*)"/)?.[1];
  const d = tag.match(/\bd="([^"]*)"/)?.[1];
  if (!className || !d) continue;

  const muscle = SVG_CLASS_TO_MUSCLE[className];
  if (!muscle) continue;

  if (!byMuscle.has(muscle)) byMuscle.set(muscle, []);
  byMuscle.get(muscle).push(d.replace(/\s+/g, ' ').trim());
}

if (byMuscle.size === 0) {
  throw new Error(`No classed paths found in ${SVG_PATH} — has the illustration changed shape?`);
}

/** Horizontal extent of a path, used to tell the two views apart. */
function xExtent(d) {
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const xs = numbers.filter((_, index) => index % 2 === 0);
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

/** Area of a `minX minY width height` viewBox string. */
function boxArea(viewBox) {
  const [, , width, height] = viewBox.split(' ').map(Number);
  return width * height;
}

const canvasWidth = Number(svg.match(/viewBox="[\d.\s-]*?\s([\d.]+)\s[\d.]+"/)?.[1]);
if (!Number.isFinite(canvasWidth)) {
  throw new Error('Could not read the illustration viewBox width.');
}

// The illustration draws the body twice, front view beside back view. Five
// muscles are labelled in both, and measuring those together yields a box
// spanning the whole canvas — two half-bodies shrunk into a tile rather than
// one muscle. So each muscle is split by view and only one view is kept.
const seam = canvasWidth / 2;
const straddlers = [...byMuscle.values()]
  .flat()
  .filter((d) => {
    const { min, max } = xExtent(d);
    return min < seam && max > seam;
  });
if (straddlers.length) {
  throw new Error(
    `${straddlers.length} path(s) cross the midline at x=${seam}, so the two ` +
      'views cannot be separated by it. Has the illustration been re-laid-out?',
  );
}

const entries = [...byMuscle.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([muscle, paths]) => {
    const views = {
      front: paths.filter((d) => xExtent(d).max <= seam),
      back: paths.filter((d) => xExtent(d).min >= seam),
    };

    // Concatenating subpaths into one `d` is valid SVG: each begins with its
    // own `M`, so they draw as one multi-part shape.
    const measured = Object.entries(views)
      .filter(([, group]) => group.length > 0)
      .map(([view, group]) => {
        const d = group.join(' ');
        return { view, d, viewBox: boundingBox(d), count: group.length };
      });

    // Where a muscle appears in both, keep the view that draws it in more
    // pieces — a proxy for the view it is detailed in, and so the one it is
    // meant to be read from: calves and traps from behind, abdominals from the
    // front. Ties break to the front, the conventional view of a body.
    //
    // It is a heuristic, so its answer is not left to chance: the chosen view
    // for every muscle is asserted in `__tests__/constants/muscleArt.test.ts`,
    // and a regeneration that flips one fails there rather than shipping an
    // "Abs" tile showing someone's back. Measuring by area was the first try
    // and did exactly that — obliques wrap further round the back than the abs
    // reach across the front.
    measured.sort((a, b) => b.count - a.count || (a.view === 'front' ? -1 : 1));
    return { muscle, ...measured[0], views: measured.length };
  });

const covered = new Set(entries.map((entry) => entry.muscle));
const uncovered = [...new Set(Object.values(SVG_CLASS_TO_MUSCLE))].filter((m) => !covered.has(m));
if (uncovered.length) {
  throw new Error(`Mapped but not found in the SVG: ${uncovered.join(', ')}`);
}

const body = entries
  .map(
    ({ muscle, d, viewBox, count, view, views }) =>
      `  '${muscle}': {\n` +
      `    // ${count} path${count === 1 ? '' : 's'}, ${view} view` +
      `${views > 1 ? ' (drawn in both views; this is the detailed one)' : ''}\n` +
      `    view: '${view}',\n` +
      `    viewBox: '${viewBox}',\n` +
      `    d: '${d}',\n` +
      `  },`,
  )
  .join('\n');

const out = `/**
 * Anatomical art for the Pick Muscles grid, keyed by canonical muscle.
 *
 * GENERATED — do not edit. Run \`pnpm run muscle-art:generate\` instead, which
 * re-derives this from \`SparkyFitnessFrontend/public/images/muscle-male.svg\`,
 * the illustration the web body map already renders. That file is upstream's,
 * so regenerating is how this stays in step with it.
 *
 * Only the muscles the illustration draws appear here. The rest have no entry
 * and their tiles fall back to a labelled colour block — see \`MuscleTile\`.
 */
import type { Muscle } from '@workspace/shared';

export interface MuscleArt {
  /**
   * Which of the illustration's two bodies this muscle is taken from.
   *
   * Carried as data, not a comment, because the generator picks it with a
   * heuristic — the view drawing the muscle in more pieces, ties to the front.
   * The test asserts the choice per muscle so a regeneration that flips one
   * fails there instead of shipping an "Abs" tile showing a back.
   */
  view: 'front' | 'back';
  /** Viewport the path coordinates are expressed in, framed on this muscle. */
  viewBox: string;
  /** Every path the illustration draws for this muscle, as one \`d\`. */
  d: string;
}

export const MUSCLE_ART: Partial<Record<Muscle, MuscleArt>> = {
${body}
};
`;

writeFileSync(OUT_PATH, out);
console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${entries.length} muscles: ${entries.map((e) => e.muscle).join(', ')}`);
