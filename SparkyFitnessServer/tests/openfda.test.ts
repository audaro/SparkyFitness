import { describe, it, expect } from 'vitest';
import {
  OPENFDA_MAX_PRODUCTS,
  OPENFDA_RXCUI_PATTERN,
  formatOpenFdaProductDetail,
  parseOpenFdaNdcResponse,
  titleCaseFdaTerm,
  type OpenFdaProduct,
} from '@workspace/shared';
import { OPENFDA_FIXTURES } from './fixtures/openFdaResponses.js';

/**
 * The pure half of the label lookup. `shared/` has no test runner, so its medication modules are
 * asserted from this package — the same arrangement as `rxterms.test.ts` and
 * `onDemandWorkouts.test.ts`.
 *
 * What these defend is narrower than the RxTerms parser's job, because nothing here becomes a
 * number on a medication record. It is display provenance, and the failure that matters is a row
 * that *looks* specific while identifying nothing — which is why a record with no product NDC is
 * dropped rather than rendered blank, and why a truncated list always carries the real total.
 */

describe('parseOpenFdaNdcResponse', () => {
  it('reads the fields the panel renders', () => {
    const { products } = parseOpenFdaNdcResponse(OPENFDA_FIXTURES.tirzepatide);

    expect(products[0]).toEqual({
      productNdc: '0002-1434',
      labelerName: 'Eli Lilly and Company',
      brandName: 'Mounjaro',
      genericName: 'tirzepatide',
      dosageForm: 'INJECTION, SOLUTION',
      routes: ['SUBCUTANEOUS'],
    });
  });

  it("reports the FDA's own total, not the page length", () => {
    // The response is paginated at OPENFDA_MAX_PRODUCTS. Reporting `results.length` would render
    // "2 of 2 listings" for a drug with 31, which reads as a complete list when it is a sample.
    const { products, totalMatches } = parseOpenFdaNdcResponse(
      OPENFDA_FIXTURES.tirzepatide
    );

    expect(products).toHaveLength(2);
    expect(totalMatches).toBe(31);
  });

  it('drops a record with no product NDC rather than showing a blank identifier', () => {
    const { products } = parseOpenFdaNdcResponse(OPENFDA_FIXTURES.metformin);

    expect(
      products.some((p) => p.labelerName === 'A labeler with no product NDC')
    ).toBe(false);
  });

  it('drops a repeated product NDC', () => {
    // The same product is listed once per package configuration. The panel is about the product.
    const { products } = parseOpenFdaNdcResponse(OPENFDA_FIXTURES.metformin);

    expect(products.map((p) => p.productNdc)).toEqual([
      '0093-1048',
      '0378-0221',
    ]);
  });

  it('reads a missing or blank field as "the FDA does not say"', () => {
    const { products } = parseOpenFdaNdcResponse(OPENFDA_FIXTURES.metformin);

    // Absent entirely on the first row, whitespace-only on the second. Both are null, so the
    // client renders an absence rather than an empty line.
    expect(products[0].brandName).toBeNull();
    expect(products[1].brandName).toBeNull();
    expect(products[1].routes).toEqual([]);
  });

  it('caps the list even when the body carries more', () => {
    const body = {
      meta: { results: { total: 40 } },
      results: Array.from({ length: 40 }, (_, i) => ({
        product_ndc: `0000-${i}`,
        labeler_name: `Labeler ${i}`,
      })),
    };

    const { products, totalMatches } = parseOpenFdaNdcResponse(body);

    expect(products).toHaveLength(OPENFDA_MAX_PRODUCTS);
    expect(totalMatches).toBe(40);
  });

  it('falls back to the usable row count when the FDA reports no total', () => {
    const body = { results: [{ product_ndc: '0002-1434' }] };

    expect(parseOpenFdaNdcResponse(body).totalMatches).toBe(1);
  });

  it('never reports a total below the number of products it returns', () => {
    // A total smaller than the page would render "2 of 1 listings". Trust the count we can see.
    const body = {
      meta: { results: { total: 1 } },
      results: [{ product_ndc: 'a' }, { product_ndc: 'b' }],
    };

    expect(parseOpenFdaNdcResponse(body).totalMatches).toBe(2);
  });

  it('survives a body with unfamiliar fields', () => {
    // openFDA adds keys without notice. A strict schema would turn that into an outage.
    const body = {
      meta: { results: { total: 1 }, some_new_meta: true },
      results: [{ product_ndc: '0002-1434', some_new_field: ['x'] }],
      another_new_top_level_key: 42,
    };

    expect(parseOpenFdaNdcResponse(body).products).toHaveLength(1);
  });

  it('answers a body it cannot read with nothing rather than throwing', () => {
    expect(parseOpenFdaNdcResponse(OPENFDA_FIXTURES.notFound)).toEqual({
      products: [],
      totalMatches: 0,
    });
    expect(parseOpenFdaNdcResponse(null)).toEqual({
      products: [],
      totalMatches: 0,
    });
    expect(parseOpenFdaNdcResponse('<html>gateway timeout</html>')).toEqual({
      products: [],
      totalMatches: 0,
    });
  });
});

describe('OPENFDA_RXCUI_PATTERN', () => {
  it('accepts an RxCUI', () => {
    expect(OPENFDA_RXCUI_PATTERN.test('2601723')).toBe(true);
    expect(OPENFDA_RXCUI_PATTERN.test('1')).toBe(true);
  });

  it('rejects anything that could reshape the Lucene query it is interpolated into', () => {
    for (const term of [
      '',
      '2601723"',
      '" OR labeler_name:"',
      '2601723 OR 1',
      'abc',
      '26017 23',
      '2601723456789012',
    ]) {
      expect(OPENFDA_RXCUI_PATTERN.test(term)).toBe(false);
    }
  });
});

describe('titleCaseFdaTerm', () => {
  it('calms the FDA down', () => {
    expect(titleCaseFdaTerm('INJECTION, SOLUTION')).toBe('Injection, Solution');
    expect(titleCaseFdaTerm('SUBCUTANEOUS')).toBe('Subcutaneous');
    expect(titleCaseFdaTerm('TABLET, FILM COATED')).toBe('Tablet, Film Coated');
  });

  it('preserves separators exactly', () => {
    expect(titleCaseFdaTerm('POWDER, FOR SOLUTION')).toBe(
      'Powder, For Solution'
    );
    expect(titleCaseFdaTerm('INTRAVENOUS/INTRAMUSCULAR')).toBe(
      'Intravenous/Intramuscular'
    );
    expect(titleCaseFdaTerm('EXTENDED-RELEASE')).toBe('Extended-Release');
  });

  it('leaves a word that is already mixed case alone', () => {
    // Unit strings and proper names lose meaning or dignity when title-cased.
    expect(titleCaseFdaTerm('mL')).toBe('mL');
    expect(titleCaseFdaTerm('McNeil Consumer')).toBe('McNeil Consumer');
  });

  it('leaves a term with no letters alone', () => {
    expect(titleCaseFdaTerm('0.9%')).toBe('0.9%');
  });
});

describe('formatOpenFdaProductDetail', () => {
  const product = (over: Partial<OpenFdaProduct>): OpenFdaProduct => ({
    productNdc: '0002-1434',
    labelerName: 'Eli Lilly and Company',
    brandName: 'Mounjaro',
    genericName: 'tirzepatide',
    dosageForm: null,
    routes: [],
    ...over,
  });

  it('joins form and route, because together they distinguish two listings of one molecule', () => {
    expect(
      formatOpenFdaProductDetail(
        product({ dosageForm: 'INJECTION, SOLUTION', routes: ['SUBCUTANEOUS'] })
      )
    ).toBe('Injection, Solution · Subcutaneous');
  });

  it('lists every route a product carries', () => {
    expect(
      formatOpenFdaProductDetail(
        product({
          dosageForm: 'SOLUTION',
          routes: ['INTRAVENOUS', 'INTRAMUSCULAR'],
        })
      )
    ).toBe('Solution · Intravenous, Intramuscular');
  });

  it('drops the half the FDA did not give rather than leaving a stray separator', () => {
    expect(formatOpenFdaProductDetail(product({ dosageForm: 'TABLET' }))).toBe(
      'Tablet'
    );
    expect(formatOpenFdaProductDetail(product({ routes: ['ORAL'] }))).toBe(
      'Oral'
    );
  });

  it('is null when there is nothing to describe the product with', () => {
    // Null rather than '' so the caller renders nothing at all.
    expect(formatOpenFdaProductDetail(product({}))).toBeNull();
  });
});
