/**
 * Draws the generated body map to PNG so it can be looked at.
 *
 *   pnpm run muscle-art:render            both views, plus a selection
 *   pnpm run muscle-art:render -- --out d put the files somewhere else
 *
 * Five of the regions are hand-authored (`muscle-art/authored-shapes.mjs`), and
 * a hand-placed blob is the one part of this that no test can judge: a suite can
 * prove a shape is inside the silhouette and big enough to hit, not that it sits
 * on the muscle it claims. So it gets eyeballed, and this is what makes that
 * cheap — Quick Look renders SVG, so there is no toolchain to install:
 *
 *   qlmanage -t -s 1600 -o <dir> <file.svg>
 *
 * The paths come from the same `buildBodyArt()` the generator uses, so what is
 * rendered here is what ships. The colours only approximate the app's tokens —
 * this is for judging geometry, not palette.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildBodyArt } from './muscle-art/build.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT_DIR = resolve(outIndex === -1 ? '.muscle-art-render' : args[outIndex + 1]);

const { paths, views } = buildBodyArt();

/** Stand-ins for the app's tokens, in its dark theme. */
const COLOURS = {
  page: '#101215',
  silhouette: '#1d2127',
  detail: '#8b95a3',
  muscle: '#3f7f6a',
  accent: '#4da3ff',
  authored: '#c46a2f',
};

/**
 * The same treatment `MuscleBodyMap` renders: an unselected region is anatomy
 * at low opacity, a selected one is a full-strength accent fill under a thick,
 * low-opacity halo of itself, with its own edge drawn back in so the pieces a
 * muscle is built from stay separate once the fill turns opaque.
 */
function figure(view, { selected = [], showAuthored = false } = {}) {
  const picked = new Set(selected);
  const dimmed = picked.size > 0;
  const parts = [];

  for (const path of paths) {
    if (path.view !== view) continue;
    if (path.kind === 'silhouette') {
      parts.push(`<path d="${path.d}" fill="${COLOURS.silhouette}" opacity="${dimmed ? 0.6 : 1}"/>`);
      continue;
    }
    if (path.kind === 'detail') {
      parts.push(`<path d="${path.d}" fill="${COLOURS.detail}" opacity="${dimmed ? 0.3 : 0.55}"/>`);
      continue;
    }
    const isSelected = picked.has(path.muscle);
    const fill =
      isSelected ? COLOURS.accent : showAuthored && path.authored ? COLOURS.authored : COLOURS.muscle;
    if (isSelected) {
      parts.push(
        `<path d="${path.d}" fill="none" stroke="${COLOURS.accent}" stroke-width="9" ` +
          'stroke-opacity="0.3" stroke-linejoin="round"/>',
      );
    }
    parts.push(
      `<path d="${path.d}" fill="${fill}" opacity="${isSelected ? 1 : 0.45}"` +
        (isSelected
          ? ` stroke="${COLOURS.silhouette}" stroke-width="1.6" stroke-linejoin="round"`
          : '') +
        '/>',
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${views[view].viewBox}">
<rect x="-1000" y="-1000" width="4000" height="4000" fill="${COLOURS.page}"/>
${parts.join('\n')}
</svg>
`;
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const authoredMuscles = [
  ...new Set(paths.flatMap((path) => (path.authored ? [path.muscle] : []))),
];

const renders = [
  ['front-plain', figure('front')],
  ['back-plain', figure('back')],
  // Every hand-authored region at once, so a blob that drifted off its muscle
  // stands out against the regions that came from the illustration.
  ['front-authored', figure('front', { showAuthored: true })],
  ['back-authored', figure('back', { showAuthored: true })],
  // And the selection treatment, which is only judgeable at size.
  ['front-selected', figure('front', { selected: ['chest', 'quadriceps', 'neck'] })],
  ['back-selected', figure('back', { selected: ['lats', 'glutes', 'abductors'] })],
];

for (const [name, svg] of renders) {
  const file = resolve(OUT_DIR, `${name}.svg`);
  writeFileSync(file, svg);
  execFileSync('qlmanage', ['-t', '-s', '1600', '-o', OUT_DIR, file], { stdio: 'ignore' });
}

console.log(`Rendered ${renders.length} views to ${OUT_DIR}`);
console.log(`  hand-authored regions, drawn in orange: ${authoredMuscles.join(', ')}`);
