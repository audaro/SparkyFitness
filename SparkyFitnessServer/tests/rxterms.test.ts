import { describe, it, expect } from 'vitest';
import {
  parseRxTermsStrength,
  parseRxTermsResponse,
  catalogCoversRxTermsProduct,
} from '@workspace/shared';
import { RXTERMS_FIXTURES } from './fixtures/rxtermsResponses.js';

/**
 * The contract for tier 3 of the medication search.
 *
 * The rule these tests exist to defend: a strength either parses correctly or does not parse at
 * all. There is no acceptable third outcome, because a half-read strength becomes a number on a
 * medication record that nobody knows is wrong. Most of what follows is therefore about refusing
 * well, not about parsing cleverly.
 */

describe('parseRxTermsStrength', () => {
  describe('reads the plain shapes', () => {
    it('takes a mass and a form', () => {
      expect(parseRxTermsStrength('0.025 mg Tab')).toMatchObject({
        value: 0.025,
        unit: 'mg',
        unparsedReason: null,
      });
    });

    it('takes a concentration, keeping the denominator in the unit', () => {
      expect(parseRxTermsStrength('200 mg/ml Injection 1 ml')).toMatchObject({
        value: 200,
        unit: 'mg/ml',
      });
    });

    it('keeps a counted denominator rather than dividing it out', () => {
      // 0.1 mg per 5 ml is 0.02 mg/ml. Doing that division here would be arithmetic the label
      // never stated, and an error in it would be silent and five-fold.
      expect(parseRxTermsStrength('0.1 mg/5ml Injection 5 ml')).toMatchObject({
        value: 0.1,
        unit: 'mg/5ml',
      });
    });

    it('takes insulin units in the spelling RxTerms uses', () => {
      expect(
        parseRxTermsStrength('100 unt/ml Pen Injector 3 ml')
      ).toMatchObject({ value: 100, unit: 'unt/ml' });
    });

    it('takes a per-actuation strength', () => {
      expect(parseRxTermsStrength('10 mg/puff Gel 120 puff')).toMatchObject({
        value: 10,
        unit: 'mg/puff',
      });
      expect(
        parseRxTermsStrength('100-20 mcg/spray Spray 120 puff').unparsedReason
      ).toBe('combination');
    });
  });

  describe('the numbers that would be misread', () => {
    it('reads grouped thousands as thousands, not as one', () => {
      // `parseFloat('1,000')` is 1. Shipping that would be a thousand-fold dosing error.
      expect(parseRxTermsStrength('1,000 mg Tab')).toMatchObject({
        value: 1000,
        unit: 'mg',
      });
    });

    it('ignores a release duration that follows the strength', () => {
      // The 24 in `500 mg 24 HR XR Tab` is hours, not milligrams.
      expect(parseRxTermsStrength('  500 mg 24 HR XR Tab')).toMatchObject({
        value: 500,
        unit: 'mg',
      });
      expect(
        parseRxTermsStrength('  1,000 mg Osmotic 24 HR XR Tab')
      ).toMatchObject({ value: 1000, unit: 'mg' });
    });

    it('ignores the container volume that follows a concentration', () => {
      // The trailing `2.4 ml` is how much liquid the pen holds, not how strong it is.
      expect(
        parseRxTermsStrength('12.5 mg/ml Pen Injector 2.4 ml')
      ).toMatchObject({ value: 12.5, unit: 'mg/ml' });
    });

    it('ignores a dose list embedded in the form text', () => {
      expect(
        parseRxTermsStrength(
          '0.68 mg/ml 0.25 MG, 0.5 MG Dose Pen Injector 3 ml'
        )
      ).toMatchObject({ value: 0.68, unit: 'mg/ml' });
    });

    it('survives the pad spaces RxTerms sorts with', () => {
      expect(parseRxTermsStrength(' 4.17 mg/ml Sol').value).toBe(4.17);
      expect(parseRxTermsStrength('  500 mg Tab').value).toBe(500);
      // The raw string is reported trimmed, so nothing downstream has to trim it again.
      expect(parseRxTermsStrength('  500 mg Tab').raw).toBe('500 mg Tab');
    });
  });

  describe('refuses rather than guesses', () => {
    it('refuses a combination product', () => {
      // Two actives at two strengths. Either number alone describes a different drug.
      for (const raw of [
        '0.025-0.00625 mg Tab',
        '1,000-50 mg Tab',
        '  0.833-0.167 mg/ml Sol',
      ]) {
        expect(parseRxTermsStrength(raw)).toMatchObject({
          value: null,
          unit: null,
          unparsedReason: 'combination',
        });
      }
    });

    it('refuses a percentage', () => {
      expect(parseRxTermsStrength(' 1% Gel')).toMatchObject({
        value: null,
        unparsedReason: 'percent',
      });
      expect(parseRxTermsStrength(' 1.62% Gel').unparsedReason).toBe('percent');
    });

    it('refuses a unit it does not claim to know', () => {
      expect(parseRxTermsStrength('5 sprinkles Tab').unparsedReason).toBe(
        'unrecognised'
      );
      expect(parseRxTermsStrength('5 mg/fortnight Tab').unparsedReason).toBe(
        'unrecognised'
      );
    });

    it('refuses a string that does not start with a number', () => {
      for (const raw of ['', '   ', 'Tab', 'Drug Implant', 'as directed']) {
        expect(parseRxTermsStrength(raw).unparsedReason).toBe('unrecognised');
      }
    });

    it('never reports a value without a unit, or a unit without a value', () => {
      // The two fields are written to the medications row together; one without the other is a
      // half-parsed strength by another name.
      const everyStrength = Object.values(RXTERMS_FIXTURES).flatMap((payload) =>
        parseRxTermsResponse(payload).flatMap((product) => product.strengths)
      );
      expect(everyStrength.length).toBeGreaterThan(20);
      for (const strength of everyStrength) {
        expect(strength.value === null).toBe(strength.unit === null);
        expect(strength.value === null).toBe(strength.unparsedReason !== null);
        // Whatever happened to the numbers, the string the user reads is intact.
        expect(strength.raw.length).toBeGreaterThan(0);
      }
    });

    it('stays inside the strength_unit column', () => {
      // `medications.strength_unit` is VARCHAR(20); a longer unit would fail on insert.
      const units = Object.values(RXTERMS_FIXTURES)
        .flatMap((payload) => parseRxTermsResponse(payload))
        .flatMap((product) => product.strengths)
        .map((strength) => strength.unit)
        .filter((unit): unit is string => unit !== null);
      expect(units.length).toBeGreaterThan(0);
      for (const unit of units) expect(unit.length).toBeLessThanOrEqual(20);
    });
  });
});

describe('catalogCoversRxTermsProduct', () => {
  it('covers the incretins, which the catalog describes better', () => {
    // RxTerms gives the concentration in the pen; the catalog gives the dose the pen dials.
    expect(catalogCoversRxTermsProduct('Semaglutide (Injectable)')).toBe(true);
    expect(catalogCoversRxTermsProduct('Semaglutide (Oral Pill)')).toBe(true);
    expect(catalogCoversRxTermsProduct('Tirzepatide (Injectable)')).toBe(true);
  });

  it('does not cover the drugs tier 3 exists for', () => {
    expect(catalogCoversRxTermsProduct('Testosterone (Injectable)')).toBe(
      false
    );
    expect(catalogCoversRxTermsProduct('Levothyroxine (Oral Pill)')).toBe(
      false
    );
    expect(catalogCoversRxTermsProduct('Metformin (Oral Pill)')).toBe(false);
  });

  it('matches exactly, so a longer name is not swallowed by a shorter one', () => {
    // A substring rule would let the catalog's own entries suppress unrelated combinations.
    expect(
      catalogCoversRxTermsProduct('Levothyroxine/Liothyronine (Oral Pill)')
    ).toBe(false);
    expect(catalogCoversRxTermsProduct('DEPO-TESTOSTERONE (Injectable)')).toBe(
      false
    );
  });

  it('reads a name with no parenthetical', () => {
    expect(catalogCoversRxTermsProduct('Semaglutide')).toBe(true);
    expect(catalogCoversRxTermsProduct('Testosterone')).toBe(false);
  });
});

describe('parseRxTermsResponse', () => {
  it('returns the testosterone products the tier exists to ship', () => {
    const products = parseRxTermsResponse(RXTERMS_FIXTURES.testosterone);
    expect(products.map((p) => p.displayName)).toEqual([
      'Testosterone (Injectable)',
      'DEPO-TESTOSTERONE (Injectable)',
      'Testosterone (Implant)',
      'Testosterone (Topical)',
      'Testosterone (Nasal)',
    ]);

    const injectable = products[0];
    expect(injectable.baseName).toBe('Testosterone');
    expect(injectable.doseForm).toBe('Injectable');
    expect(injectable.strengths[4]).toMatchObject({
      raw: '200 mg/ml Injection 1 ml',
      value: 200,
      unit: 'mg/ml',
      rxcui: '2047882',
    });
  });

  it('keeps each strength with its own RxCUI', () => {
    const [injectable] = parseRxTermsResponse(RXTERMS_FIXTURES.testosterone);
    // Parallel arrays, matched by position — the pairing is the whole point of asking for both.
    expect(injectable.strengths.map((s) => s.rxcui)).toEqual([
      '2099689',
      '835829',
      '2099695',
      '2099681',
      '2047882',
      '2694309',
      '835809',
      '1490661',
    ]);
  });

  it('drops the products the curated catalog already covers', () => {
    // Both semaglutide rows are suppressed, so the whole response comes back empty rather than
    // offering a concentration next to the catalog's ladder.
    expect(parseRxTermsResponse(RXTERMS_FIXTURES.semaglutide)).toEqual([]);
    expect(parseRxTermsResponse(RXTERMS_FIXTURES.tirzepatide)).toEqual([]);
  });

  it('returns nothing for a drug RxTerms does not carry', () => {
    // Retatrutide is investigational, so it will not be here until approval — which is exactly
    // why the curated catalog exists and why tier 2 outranks tier 3.
    expect(parseRxTermsResponse(RXTERMS_FIXTURES.retatrutide)).toEqual([]);
    expect(parseRxTermsResponse(RXTERMS_FIXTURES.noHits)).toEqual([]);
  });

  it('does not borrow an RxCUI from a neighbouring strength', () => {
    // A short RXCUIS list is a malformed response, not a licence to misattribute an identifier.
    const payload = [
      1,
      ['Widgetol (Oral Pill)'],
      {
        STRENGTHS_AND_FORMS: [['5 mg Tab', '10 mg Tab', '20 mg Tab']],
        RXCUIS: [['111']],
      },
      [['Widgetol (Oral Pill)']],
    ];
    const [product] = parseRxTermsResponse(payload);
    expect(product.strengths.map((s) => s.rxcui)).toEqual(['111', null, null]);
  });

  it('tolerates a response carrying no extra fields at all', () => {
    const [product] = parseRxTermsResponse([
      1,
      ['Widgetol (Oral Pill)'],
      {},
      [['Widgetol (Oral Pill)']],
    ]);
    expect(product).toMatchObject({ baseName: 'Widgetol', strengths: [] });
  });

  it('throws on a shape it does not recognise, rather than reading it as empty', () => {
    // The failure this guards: NLM changes the envelope, every parse silently yields no
    // strengths, and tier 3 quietly degrades into a list of names with no doses.
    expect(() => parseRxTermsResponse({ results: [] })).toThrow();
    expect(() => parseRxTermsResponse([0])).toThrow();
    expect(() => parseRxTermsResponse(null)).toThrow();
    expect(() => parseRxTermsResponse([0, 'notanarray', {}])).toThrow();
  });

  it('parses every recorded fixture without throwing', () => {
    for (const payload of Object.values(RXTERMS_FIXTURES)) {
      expect(() => parseRxTermsResponse(payload)).not.toThrow();
    }
  });
});
