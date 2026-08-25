/**
 * Writes `src/constants/muscleArt.generated.ts` from the anatomical
 * illustration the web app already renders,
 * `SparkyFitnessFrontend/public/images/muscle-male.svg`.
 *
 * That file is upstream's, so this is a script rather than a hand-pasted
 * constant: when upstream redraws the illustration, re-run this instead of
 * reconciling a copy by hand.
 *
 *   pnpm run muscle-art:generate
 *   pnpm run muscle-art:check      re-derive and diff, writing nothing
 *
 * `--check` is what `validate` runs. The art is generated but committed, and
 * the app renders the commit — so the check catches both halves of that going
 * stale: an override that no longer matches the illustration (the build throws,
 * and a dropped override means a region labelled as a muscle it is not), and a
 * committed file that was hand-edited or never regenerated.
 *
 * The derivation itself — relabelling, the hand-authored regions, splitting the
 * two figures into views, and every check that any of it still lines up — lives
 * in `scripts/muscle-art/build.mjs`, shared with `muscle-art:render` so that
 * what gets eyeballed is exactly what ships. This file only formats the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBodyArt } from './muscle-art/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(here, '../src/constants/muscleArt.generated.ts');

const { paths, views, aspect, muscles } = buildBodyArt();

const body = paths
  .map((path) => {
    const view = `view: '${path.view}'`;
    if (path.kind !== 'muscle') return `  { kind: '${path.kind}', ${view}, d: '${path.d}' },`;
    const authored = path.authored ? ', authored: true' : '';
    return `  { kind: 'muscle', muscle: '${path.muscle}', ${view}${authored}, d: '${path.d}' },`;
  })
  .join('\n');

const counts = Object.fromEntries(
  ['front', 'back'].map((view) => [view, paths.filter((path) => path.view === view).length]),
);

const out = `/**
 * The anatomical figure behind the Pick Muscles body map.
 *
 * GENERATED — do not edit. Run \`pnpm run muscle-art:generate\` instead, which
 * re-derives this from \`SparkyFitnessFrontend/public/images/muscle-male.svg\`,
 * the illustration the web body map already renders. That file is upstream's,
 * so regenerating is how this stays in step with it. \`pnpm run
 * muscle-art:render\` draws the same paths to PNG to look at.
 *
 * The array is in the illustration's own document order, which is its render
 * order: silhouette first, muscles over it, outline detail last. The five
 * \`authored\` regions are merged in after the last of upstream's muscles, which
 * puts them over the body and under the head and hands.
 */
import type { Muscle } from '@workspace/shared';

/** Which figure a path is drawn on. The screen shows one at a time. */
export type BodyView = 'front' | 'back';

interface BodyPathBase {
  readonly view: BodyView;
  readonly d: string;
}

export type BodyPath =
  /** A labelled region, tappable as its muscle. */
  | (BodyPathBase & {
      readonly kind: 'muscle';
      readonly muscle: Muscle;
      /**
       * Drawn by hand rather than taken from upstream, for a muscle the
       * illustration has no geometry for. See \`scripts/muscle-art/authored-shapes.mjs\`.
       */
      readonly authored?: true;
    })
  /** The body itself, drawn under everything. */
  | (BodyPathBase & { readonly kind: 'silhouette' })
  /** Outline detail — head, hands, creases — drawn over everything. */
  | (BodyPathBase & { readonly kind: 'detail' });

/**
 * Each figure's own coordinate window.
 *
 * Both boxes are the same size, so flipping the view does not resize the body;
 * each is centred on its own silhouette. Showing one figure at a time is what
 * makes the regions tappable at all — side by side on a phone, most muscles are
 * 10–20pt across.
 */
export const BODY_VIEWS: Readonly<Record<BodyView, { readonly viewBox: string }>> = {
  front: { viewBox: '${views.front.viewBox}' },
  back: { viewBox: '${views.back.viewBox}' },
};

/** The shape of either view, for the container the figure is drawn into. */
export const BODY_VIEW_ASPECT = ${Number(aspect.toFixed(6))};

/**
 * Every canonical muscle, all of which the figure now draws.
 *
 * It stays exported, rather than being folded away as "all of them", because it
 * is the generator's own record of what it found: a regeneration that loses a
 * region fails a test here instead of quietly making that muscle unpickable.
 */
export const MUSCLES_ON_BODY: readonly Muscle[] = [
${muscles.map((muscle) => `  '${muscle}',`).join('\n')}
];

export const BODY_PATHS: readonly BodyPath[] = [
${body}
];
`;

if (process.argv.includes('--check')) {
  const committed = readFileSync(OUT_PATH, 'utf8');
  if (committed !== out) {
    console.error(
      `${OUT_PATH} is not what the illustration produces today.\n` +
        'Run `pnpm run muscle-art:generate`, look at the result with ' +
        '`pnpm run muscle-art:render`, and commit both. Never hand-edit the ' +
        'generated file — the next regeneration would drop the edit.',
    );
    process.exit(1);
  }
  console.log(`${OUT_PATH} is up to date (${paths.length} paths, ${muscles.length} muscles).`);
} else {
  writeFileSync(OUT_PATH, out);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  ${paths.length} paths (${counts.front} front, ${counts.back} back)`);
  console.log(`  ${muscles.length} muscles: ${muscles.join(', ')}`);
}
