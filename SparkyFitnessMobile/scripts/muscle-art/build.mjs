/**
 * Derives the Pick Muscles body map from the illustration the web app renders,
 * `SparkyFitnessFrontend/public/images/muscle-male.svg`.
 *
 * This is the shared step behind two scripts, so that what gets eyeballed is
 * exactly what gets shipped:
 *
 *   pnpm run muscle-art:generate   writes src/constants/muscleArt.generated.ts
 *   pnpm run muscle-art:render     renders the same paths to PNG to look at
 *
 * Three things happen here that a plain read of the SVG would not do:
 *
 * 1. Four paths are relabelled (`relabelled-paths.mjs`) — upstream's class
 *    names are the web app's vocabulary, not this repo's.
 * 2. Five hand-authored shapes are merged in (`authored-shapes.mjs`) for the
 *    three muscles the figure has no geometry for at all.
 * 3. Every path is assigned to the front figure or the back one, because the
 *    screen shows one view at a time. Side by side, a muscle on a phone is a
 *    10–20pt tap target; alone it is twice that.
 *
 * Everything here throws rather than degrades. A silently half-drawn figure is
 * a muscle the user cannot target and no error anywhere.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTHORED_SHAPES } from './authored-shapes.mjs';
import { RELABELLED_PATHS } from './relabelled-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const SVG_PATH = resolve(
  here,
  '../../../SparkyFitnessFrontend/public/images/muscle-male.svg',
);
const TAXONOMY_PATH = resolve(here, '../../../shared/src/constants/exerciseTaxonomy.ts');

/**
 * The illustration's class names against this repo's canonical vocabulary.
 *
 * `obliques` folds into `abdominals` because the vocabulary has no separate
 * member for it, exactly as the web app's `svgClassToSchemaName` does — but
 * only for the paths `relabelled-paths.mjs` does not claim first, since four of
 * them are not obliques at all.
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

/**
 * The illustration's two unlabelled fills. The pale one is the body itself, the
 * dark one is outline detail drawn over everything (head, hands, creases).
 * Matched by colour because that is the only thing telling them apart in the
 * file — neither carries a class.
 */
const SILHOUETTE_FILL = '#f5f5f5';
const DETAIL_FILL = '#757575';

/** A little slack around each figure so nothing is clipped by rounding. */
const VIEW_PADDING = 2;

/**
 * The canonical muscle list, read out of `@workspace/shared` rather than
 * copied. This is a plain `.mjs` script and cannot import the TypeScript, but a
 * hardcoded copy would drift the moment upstream's taxonomy grew a member —
 * and drifting quietly is the one failure this whole file exists to prevent.
 */
export function readCanonicalMuscles() {
  const source = readFileSync(TAXONOMY_PATH, 'utf8');
  const block = source.match(/export const MUSCLES = \[([\s\S]*?)\] as const;/)?.[1];
  if (!block) {
    throw new Error(
      `Could not find "export const MUSCLES = [...] as const;" in ${TAXONOMY_PATH}. ` +
        'The canonical vocabulary moved — point this at its new home rather than ' +
        'inlining a copy, or the figure will silently stop covering it.',
    );
  }
  const muscles = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (muscles.length === 0) {
    throw new Error(`MUSCLES in ${TAXONOMY_PATH} parsed as empty.`);
  }
  return muscles;
}

// ---------------------------------------------------------------------------
// Geometry
//
// Enough of an SVG path reader to answer two questions: where is this path, and
// is it inside the body? Absolute M/L/C/Z only, which is all the illustration
// uses and all the authored shapes are allowed to use.
// ---------------------------------------------------------------------------

/** Flattens a path to a polyline, subdividing each cubic into `steps` chords. */
export function flatten(d, steps = 12) {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points = [];
  let cursor = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let command = null;
  let index = 0;

  const number = () => {
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) {
      throw new Error(`Malformed path near token ${index} of: ${d.slice(0, 60)}…`);
    }
    return value;
  };

  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) {
      command = tokens[index++].toUpperCase();
      if (command === 'Z') {
        points.push({ ...start });
        continue;
      }
    }
    if (command === 'M') {
      cursor = { x: number(), y: number() };
      start = { ...cursor };
      points.push({ ...cursor });
      // A second coordinate pair after M is an implicit lineto, per the spec.
      command = 'L';
    } else if (command === 'L') {
      cursor = { x: number(), y: number() };
      points.push({ ...cursor });
    } else if (command === 'C') {
      const p1 = { x: number(), y: number() };
      const p2 = { x: number(), y: number() };
      const p3 = { x: number(), y: number() };
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        points.push({
          x: u * u * u * cursor.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * cursor.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
      cursor = p3;
    } else {
      throw new Error(`Unsupported path command "${command}" in: ${d.slice(0, 60)}…`);
    }
  }

  return points;
}

/** The true bounding box of a path, from its flattened curve — not its control points. */
export function bounds(d) {
  const points = flatten(d);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** Even-odd ray casting against a flattened outline. */
function contains(polygon, point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const crossing = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < crossing) inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/**
 * Reads the illustration and returns everything the two scripts need.
 *
 * @returns {{paths: object[], views: Record<string, {viewBox: string}>, aspect: number,
 *            muscles: string[], sourceViewBox: string}}
 */
export function buildBodyArt() {
  const svg = readFileSync(SVG_PATH, 'utf8');

  const sourceViewBox = svg.match(/<svg[^>]*\bviewBox="([^"]+)"/)?.[1];
  if (!sourceViewBox) {
    throw new Error(`Could not read the illustration's viewBox from ${SVG_PATH}.`);
  }

  const relabelled = new Map(RELABELLED_PATHS.map((entry) => [entry.d, entry.muscle]));
  const matched = new Set();

  // Document order is render order, and it matters: the pale silhouette is
  // drawn first so the muscles sit on top of it, and the outline detail last so
  // it sits on top of them. Preserving the order preserves the layering, with
  // no z-index reasoning of our own.
  const paths = [];
  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const className = tag.match(/\bclass="([^"]*)"/)?.[1];
    const rawD = tag.match(/\bd="([^"]*)"/)?.[1];
    if (!rawD) continue;

    const d = rawD.replace(/\s+/g, ' ').trim();

    const override = relabelled.get(d);
    if (override) {
      matched.add(d);
      paths.push({ kind: 'muscle', muscle: override, d, authored: false });
      continue;
    }

    if (className) {
      const muscle = SVG_CLASS_TO_MUSCLE[className];
      if (!muscle) {
        throw new Error(
          `Path classed "${className}" has no entry in SVG_CLASS_TO_MUSCLE. Add ` +
            'it (mapped to a canonical muscle), or that region silently stops ' +
            'being tappable.',
        );
      }
      paths.push({ kind: 'muscle', muscle, d, authored: false });
      continue;
    }

    const fill = tag.match(/\bfill="([^"]*)"/)?.[1];
    if (fill === SILHOUETTE_FILL) {
      paths.push({ kind: 'silhouette', d });
    } else if (fill === DETAIL_FILL) {
      paths.push({ kind: 'detail', d });
    } else {
      throw new Error(
        `Unclassed path with fill "${fill}" is neither the silhouette ` +
          `(${SILHOUETTE_FILL}) nor outline detail (${DETAIL_FILL}). The figure ` +
          'would render with a piece missing.',
      );
    }
  }

  if (paths.length === 0) {
    throw new Error(`No paths found in ${SVG_PATH} — has the illustration changed shape?`);
  }

  const unmatched = RELABELLED_PATHS.filter((entry) => !matched.has(entry.d));
  if (unmatched.length) {
    throw new Error(
      `${unmatched.length} relabelled path(s) found no match in the illustration: ` +
        `${unmatched.map((entry) => `${entry.muscle} (${entry.note})`).join('; ')}. ` +
        'Upstream has redrawn the figure. Re-find those regions against a render ' +
        'and update `relabelled-paths.mjs` — do not delete the entry, or the ' +
        'muscle goes back to being labelled as something it is not.',
    );
  }

  const silhouettes = paths.filter((path) => path.kind === 'silhouette');
  if (silhouettes.length !== 2) {
    throw new Error(
      `Expected two silhouettes — one figure each — but found ${silhouettes.length}. ` +
        'The front/back toggle has nothing to split the paths by.',
    );
  }
  for (const silhouette of silhouettes) {
    silhouette.outline = flatten(silhouette.d);
    silhouette.box = bounds(silhouette.d);
  }

  // Which silhouette is the front one is decided by where the chest is drawn,
  // not by document order: the answer stays right if upstream swaps the figures.
  const chest = paths.find((path) => path.kind === 'muscle' && path.muscle === 'chest');
  if (!chest) {
    throw new Error('No chest region found, so the front figure cannot be identified.');
  }
  const chestBox = bounds(chest.d);
  const chestMiddle = (chestBox.minX + chestBox.maxX) / 2;
  const [front, back] =
    chestMiddle >= silhouettes[0].box.minX && chestMiddle <= silhouettes[0].box.maxX
      ? silhouettes
      : [silhouettes[1], silhouettes[0]];
  front.view = 'front';
  back.view = 'back';

  const viewOf = (d) => {
    const box = bounds(d);
    const middle = (box.minX + box.maxX) / 2;
    const hits = [front, back].filter(
      (figure) => middle >= figure.box.minX && middle <= figure.box.maxX,
    );
    if (hits.length !== 1) {
      throw new Error(
        `A path centred on x=${middle.toFixed(1)} sits on ${hits.length} figures. ` +
          'The two silhouettes overlap or the path is between them, so it cannot ' +
          `be assigned to a view: ${d.slice(0, 60)}…`,
      );
    }
    return hits[0].view;
  };

  for (const path of paths) {
    path.view = path.view ?? viewOf(path.d);
  }

  // The authored shapes go in after the last upstream muscle: over the
  // silhouette they belong to, and under the outline detail that is drawn later
  // — the head especially, which the neck column butts up against.
  const lastMuscle = paths.map((path) => path.kind).lastIndexOf('muscle');
  const authored = AUTHORED_SHAPES.map((shape) => {
    const view = viewOf(shape.d);
    const figure = view === 'front' ? front : back;
    const escaped = flatten(shape.d).filter((point) => !contains(figure.outline, point));
    if (escaped.length) {
      const worst = escaped[0];
      throw new Error(
        `The authored ${shape.muscle} region falls outside the ${view} silhouette ` +
          `(${escaped.length} of its points, e.g. ${worst.x.toFixed(1)},${worst.y.toFixed(1)}). ` +
          `It would draw as a blob floating off the body. ${shape.note}`,
      );
    }
    return { kind: 'muscle', muscle: shape.muscle, d: shape.d, view, authored: true };
  });
  paths.splice(lastMuscle + 1, 0, ...authored);

  const muscles = readCanonicalMuscles();
  const drawn = new Set(paths.flatMap((path) => (path.kind === 'muscle' ? [path.muscle] : [])));
  const missing = muscles.filter((muscle) => !drawn.has(muscle));
  if (missing.length) {
    throw new Error(
      `No region for: ${missing.join(', ')}. Every canonical muscle has to be ` +
        'tappable — add it to `authored-shapes.mjs`, or a user simply cannot ' +
        'target it.',
    );
  }
  const stray = [...drawn].filter((muscle) => !muscles.includes(muscle));
  if (stray.length) {
    throw new Error(`Not canonical muscles: ${stray.join(', ')}.`);
  }

  // Both views get the same box size so the figure does not resize when it is
  // flipped; each is centred on its own silhouette.
  const boxes = [front.box, back.box];
  const width = Math.ceil(Math.max(...boxes.map((box) => box.maxX - box.minX))) + VIEW_PADDING * 2;
  const minY = Math.floor(Math.min(...boxes.map((box) => box.minY))) - VIEW_PADDING;
  const height = Math.ceil(Math.max(...boxes.map((box) => box.maxY))) + VIEW_PADDING - minY;
  const viewBoxFor = (figure) => {
    const middle = (figure.box.minX + figure.box.maxX) / 2;
    return `${round(middle - width / 2)} ${minY} ${width} ${height}`;
  };

  return {
    paths: paths.map(({ kind, muscle, d, view, authored: isAuthored }) => ({
      kind,
      muscle,
      d,
      view,
      authored: isAuthored,
    })),
    views: { front: { viewBox: viewBoxFor(front) }, back: { viewBox: viewBoxFor(back) } },
    aspect: width / height,
    muscles,
    sourceViewBox,
  };
}

function round(value) {
  return Number(value.toFixed(2));
}
