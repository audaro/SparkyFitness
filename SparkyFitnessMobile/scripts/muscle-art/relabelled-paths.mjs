/**
 * Paths the illustration draws under the wrong name for this vocabulary.
 *
 * `SparkyFitnessFrontend/public/images/muscle-male.svg` is upstream's, and its
 * class names are the web app's, not this repo's canonical `MUSCLES`. Two of
 * its regions are simply mislabelled for us, and one of those was a live bug:
 * the wings under the armpits on the back figure are classed `obliques`, the
 * generator folds `obliques` into `abdominals`, so tapping a lat selected Abs.
 *
 * Each override is keyed on the **exact `d` string**, never on a path index:
 * an upstream reorder would silently re-point an index-keyed override at the
 * wrong muscle, while a `d` that no longer matches makes the generator throw
 * and forces someone to look at the redrawn figure.
 *
 * What is *not* here matters too. The lower lateral `obliques` paths stay
 * `abdominals` — those genuinely are the flank — and `traps` keeps the neck
 * yoke on the back figure and the two upper-trap wedges on the front, so
 * relabelling the spine slabs does not leave the trapezius regionless.
 */

/**
 * @typedef {object} RelabelledPath
 * @property {string} muscle The canonical muscle this path actually draws.
 * @property {string} d The upstream path, verbatim, whitespace-collapsed.
 * @property {string} note Which region it is, and why upstream's name is wrong.
 */

/** @type {readonly RelabelledPath[]} */
export const RELABELLED_PATHS = [
  {
    muscle: 'lats',
    note:
      'Back figure, the left wing under the armpit. Classed `obliques` upstream, which the web app folds into the abdominals — so before this override, tapping a lat selected Abs.',
    d:
      'M 452.92,116.24 C 452.92,116.24 452.75,111.80 452.75,111.80 452.75,111.80 452.74,111.80 '
      + '452.74,111.80 452.71,111.52 452.65,111.21 452.55,110.84 452.25,109.81 451.90,108.79 '
      + '451.53,107.77 449.58,102.43 446.27,98.13 441.63,94.86 439.64,93.45 438.68,93.88 '
      + '438.25,96.24 437.60,99.79 436.62,103.26 434.81,106.37 433.22,109.09 431.31,111.63 '
      + '429.54,114.24 429.54,114.24 426.99,118.41 426.99,118.41 424.12,122.80 421.24,127.18 '
      + '418.38,131.58 417.40,133.09 417.39,134.61 418.48,136.10 421.78,140.59 425.64,144.48 '
      + '430.44,147.38 434.04,149.56 437.71,149.46 441.37,147.65 445.32,145.70 447.79,142.32 '
      + '449.73,138.50 452.39,133.25 453.16,127.59 453.20,120.88 453.14,119.93 453.06,118.08 '
      + '452.92,116.24',
  },
  {
    muscle: 'lats',
    note:
      'Back figure, the right wing under the armpit.',
    d:
      'M 403.69,137.15 C 405.75,134.61 405.91,133.56 404.16,130.82 401.53,126.69 398.77,122.65 '
      + '396.09,118.55 396.09,118.55 394.01,115.00 394.01,115.00 394.01,115.00 393.84,114.97 '
      + '393.84,114.97 393.73,114.71 393.57,114.43 393.34,114.11 392.00,112.22 390.57,110.40 '
      + '389.33,108.45 386.85,104.57 385.39,100.28 384.61,95.75 384.32,94.04 383.40,93.64 '
      + '381.89,94.51 381.26,94.88 380.66,95.31 380.09,95.76 375.26,99.63 372.19,104.64 '
      + '370.49,110.55 370.35,111.05 370.27,111.45 370.24,111.80 370.24,111.80 370.24,111.80 '
      + '370.24,111.80 370.24,111.80 370.05,116.31 370.05,116.31 369.93,118.08 369.84,119.85 '
      + '369.73,121.63 369.82,123.32 369.87,125.01 370.02,126.70 370.53,132.63 372.41,138.07 '
      + '375.97,142.87 378.15,145.81 381.03,147.83 384.60,148.72 388.07,149.59 391.14,148.39 '
      + '393.98,146.49 397.77,143.96 400.84,140.67 403.69,137.15',
  },
  {
    muscle: 'middle back',
    note:
      'Back figure, the left slab down the spine. Classed `traps` upstream; the region is mid and lower trapezius plus the rhomboids, which is what "middle back" means in this vocabulary.',
    d:
      'M 406.94,81.88 C 405.66,78.80 403.68,76.45 400.04,75.90 395.59,75.23 391.12,74.84 '
      + '386.69,75.63 383.08,76.27 379.54,77.36 375.97,78.25 375.97,78.42 375.97,78.59 '
      + '375.97,78.76 381.23,80.32 383.31,84.46 384.56,89.25 385.03,91.07 385.37,92.93 '
      + '385.78,94.78 386.65,98.66 387.50,102.60 389.72,105.96 393.31,111.39 397.04,116.74 '
      + '400.84,122.03 404.25,126.77 407.77,131.41 409.53,137.08 409.90,138.27 410.14,139.50 '
      + '410.51,140.99 410.61,139.02 410.79,137.33 410.77,135.65 410.67,122.97 410.48,110.28 '
      + '410.41,97.59 410.37,92.08 409.03,86.89 406.94,81.88',
  },
  {
    muscle: 'middle back',
    note:
      'Back figure, the right slab down the spine.',
    d:
      'M 424.86,75.58 C 421.55,75.92 418.66,76.93 416.95,80.04 414.97,83.62 413.60,87.52 '
      + '413.16,91.51 412.49,97.59 412.33,103.74 412.23,109.87 412.08,118.66 412.18,127.46 '
      + '412.19,136.26 412.20,137.66 412.33,139.06 412.40,140.46 413.72,133.20 418.01,127.57 '
      + '422.22,121.89 424.83,118.35 427.44,114.82 429.97,111.22 432.62,107.45 435.01,103.52 '
      + '436.13,98.99 436.99,95.51 437.70,91.98 438.61,88.52 439.53,85.05 441.09,81.93 '
      + '444.29,79.96 445.13,79.45 446.07,79.11 446.96,78.68 446.97,78.57 446.98,78.46 '
      + '446.98,78.35 444.21,77.57 441.46,76.69 438.66,76.03 434.10,74.96 429.48,75.11 '
      + '424.86,75.58',
  },
];
