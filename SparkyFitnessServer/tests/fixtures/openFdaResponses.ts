/**
 * openFDA `/drug/ndc.json` bodies, trimmed to the fields this app reads plus enough of the rest
 * to keep the shape honest.
 *
 * Kept as fixtures rather than as inline literals for the same reason `rxtermsResponses.ts` is:
 * the parser's whole job is to survive what the FDA actually publishes, and a body written to
 * suit the parser proves nothing. `meta.results.total` deliberately exceeds `results.length` in
 * `tirzepatide`, because that is the ordinary case for a generic and the one that makes
 * `totalMatches` mean something.
 */

export const OPENFDA_FIXTURES = {
  /** A brand product with everything filled in, and more listings than one page returns. */
  tirzepatide: {
    meta: {
      disclaimer:
        'Do not rely on openFDA to make decisions regarding medical care.',
      results: { skip: 0, limit: 5, total: 31 },
    },
    results: [
      {
        product_ndc: '0002-1434',
        generic_name: 'tirzepatide',
        labeler_name: 'Eli Lilly and Company',
        brand_name: 'Mounjaro',
        dosage_form: 'INJECTION, SOLUTION',
        route: ['SUBCUTANEOUS'],
        marketing_category: 'NDA',
        openfda: { rxcui: ['2601723'] },
      },
      {
        product_ndc: '0002-2506',
        generic_name: 'tirzepatide',
        labeler_name: 'Eli Lilly and Company',
        brand_name: 'Zepbound',
        dosage_form: 'INJECTION, SOLUTION',
        route: ['SUBCUTANEOUS'],
        marketing_category: 'NDA',
        openfda: { rxcui: ['2601723'] },
      },
    ],
  },

  /**
   * A generic listed by several labelers, with the uneven records openFDA really carries: one
   * missing its brand name, one missing its route, one repeated under a second package
   * configuration, and one with no `product_ndc` at all.
   */
  metformin: {
    meta: { results: { skip: 0, limit: 5, total: 4 } },
    results: [
      {
        product_ndc: '0093-1048',
        generic_name: 'Metformin Hydrochloride',
        labeler_name: 'Teva Pharmaceuticals USA, Inc.',
        dosage_form: 'TABLET, FILM COATED',
        route: ['ORAL'],
      },
      {
        product_ndc: '0378-0221',
        generic_name: 'Metformin Hydrochloride',
        labeler_name: 'Mylan Pharmaceuticals Inc.',
        brand_name: '   ',
        dosage_form: 'TABLET, FILM COATED',
        route: [],
      },
      {
        product_ndc: '0093-1048',
        generic_name: 'Metformin Hydrochloride',
        labeler_name: 'Teva Pharmaceuticals USA, Inc.',
        dosage_form: 'TABLET, FILM COATED',
        route: ['ORAL'],
      },
      {
        generic_name: 'Metformin Hydrochloride',
        labeler_name: 'A labeler with no product NDC',
        dosage_form: 'TABLET',
        route: ['ORAL'],
      },
    ],
  },

  /** What openFDA sends with a 404 when a search matches nothing. */
  notFound: {
    error: {
      code: 'NOT_FOUND',
      message: 'No matches found!',
    },
  },
} as const;
