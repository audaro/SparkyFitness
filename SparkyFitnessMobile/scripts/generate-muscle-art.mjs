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
 * The output is the whole illustration — both figures, front and back — as an
 * ordered list of paths, each tagged with the muscle it belongs to where the
 * illustration labels one. `MuscleBodyMap` renders them in that order, which is
 * what keeps the silhouette under the muscles and the outline detail over them,
 * and makes every labelled path a tap target for its muscle.
 *
 * It does NOT cover the whole vocabulary: the illustration knows twelve of the
 * seventeen canonical muscles. The other five have no region on the figure and
 * the screen offers them as chips instead.
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

/**
 * The illustration's two unlabelled fills. The pale one is the body itself, the
 * dark one is outline detail drawn over everything (head, hands, creases).
 * Matched by colour because that is the only thing telling them apart in the
 * file — neither carries a class.
 */
const SILHOUETTE_FILL = '#f5f5f5';
const DETAIL_FILL = '#757575';

const svg = readFileSync(SVG_PATH, 'utf8');

const viewBox = svg.match(/<svg[^>]*\bviewBox="([^"]+)"/)?.[1];
if (!viewBox) {
  throw new Error(`Could not read the illustration's viewBox from ${SVG_PATH}.`);
}

// Document order is render order, and it matters: the pale silhouette is drawn
// first so the muscles sit on top of it, and the outline detail last so it sits
// on top of them. Preserving the order preserves the layering, with no z-index
// reasoning of our own.
const paths = [];
for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
  const className = tag.match(/\bclass="([^"]*)"/)?.[1];
  const d = tag.match(/\bd="([^"]*)"/)?.[1];
  if (!d) continue;

  const cleaned = d.replace(/\s+/g, ' ').trim();

  if (className) {
    const muscle = SVG_CLASS_TO_MUSCLE[className];
    if (!muscle) {
      throw new Error(
        `Path classed "${className}" has no entry in SVG_CLASS_TO_MUSCLE. Add ` +
          'it (mapped to a canonical muscle), or that region silently stops ' +
          'being tappable.',
      );
    }
    paths.push({ kind: 'muscle', muscle, d: cleaned });
    continue;
  }

  const fill = tag.match(/\bfill="([^"]*)"/)?.[1];
  if (fill === SILHOUETTE_FILL) {
    paths.push({ kind: 'silhouette', d: cleaned });
  } else if (fill === DETAIL_FILL) {
    paths.push({ kind: 'detail', d: cleaned });
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

const found = new Set(paths.filter((p) => p.kind === 'muscle').map((p) => p.muscle));
const missing = [...new Set(Object.values(SVG_CLASS_TO_MUSCLE))].filter((m) => !found.has(m));
if (missing.length) {
  throw new Error(`Mapped but not present in the SVG: ${missing.join(', ')}`);
}
if (!paths.some((p) => p.kind === 'silhouette')) {
  throw new Error('No silhouette path found — the figure would render as floating muscles.');
}

const body = paths
  .map((path) =>
    path.kind === 'muscle'
      ? `  { kind: 'muscle', muscle: '${path.muscle}', d: '${path.d}' },`
      : `  { kind: '${path.kind}', d: '${path.d}' },`,
  )
  .join('\n');

const onBody = [...found].sort();

const out = `/**
 * The anatomical figure behind the Pick Muscles body map.
 *
 * GENERATED — do not edit. Run \`pnpm run muscle-art:generate\` instead, which
 * re-derives this from \`SparkyFitnessFrontend/public/images/muscle-male.svg\`,
 * the illustration the web body map already renders. That file is upstream's,
 * so regenerating is how this stays in step with it.
 *
 * The array is in the illustration's own document order, which is its render
 * order: silhouette first, muscles over it, outline detail last.
 */
import type { Muscle } from '@workspace/shared';

export type BodyPath =
  /** A labelled region, tappable as its muscle. */
  | { readonly kind: 'muscle'; readonly muscle: Muscle; readonly d: string }
  /** The body itself, drawn under everything. */
  | { readonly kind: 'silhouette'; readonly d: string }
  /** Outline detail — head, hands, creases — drawn over everything. */
  | { readonly kind: 'detail'; readonly d: string };

/** The illustration's coordinate space: the front figure beside the back one. */
export const BODY_VIEW_BOX = '${viewBox}';

/**
 * The muscles the figure actually draws, so the screen knows which ones it has
 * to offer some other way. Twelve of the seventeen canonical muscles.
 */
export const MUSCLES_ON_BODY: readonly Muscle[] = [
${onBody.map((muscle) => `  '${muscle}',`).join('\n')}
];

export const BODY_PATHS: readonly BodyPath[] = [
${body}
];
`;

writeFileSync(OUT_PATH, out);
console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${paths.length} paths, ${onBody.length} muscles: ${onBody.join(', ')}`);
