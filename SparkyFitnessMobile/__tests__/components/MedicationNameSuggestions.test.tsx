import { fireEvent, render, within } from '@testing-library/react-native';
import type { Medication, RxTermsProduct } from '@workspace/shared';
import MedicationNameSuggestions from '../../src/components/MedicationNameSuggestions';

/**
 * Tier 3 in the suggestion list. What is under test is ordering and identity: which rows appear,
 * in what order, under what label, and what a pick reports back.
 */

// `mock`-prefixed so the jest.mock factory below may close over it.
let mockCatalogProducts: RxTermsProduct[] = [];
let mockCorrectedTerms: string[] = [];

jest.mock('../../src/hooks/useMedicationCatalogSearch', () => ({
  useMedicationCatalogSearch: () => ({
    products: mockCatalogProducts,
    correctedTerms: mockCorrectedTerms,
    isFetching: false,
  }),
}));

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View testID="icon" /> };
});

const strength = (
  raw: string,
  value: number | null,
  unit: string | null,
): RxTermsProduct['strengths'][number] => ({
  raw,
  rxcui: '12345',
  value,
  unit,
  unparsedReason: value === null ? 'unrecognised' : null,
});

const product = (
  baseName: string,
  strengths: RxTermsProduct['strengths'] = [],
): RxTermsProduct => ({
  displayName: `${baseName} (Injectable)`,
  baseName,
  doseForm: 'Injectable',
  strengths,
});

const medication = (name: string, overrides: Partial<Medication> = {}): Medication =>
  ({
    id: `med-${name}`,
    name,
    display_name: null,
    strength_value: null,
    strength_unit: null,
    is_active: true,
    last_taken_at: null,
    ...overrides,
  }) as unknown as Medication;

const renderList = (
  query: string,
  ownMedications: Medication[] = [],
  onPick: (pick: unknown) => void = jest.fn(),
) =>
  render(
    <MedicationNameSuggestions
      query={query}
      ownMedications={ownMedications}
      onPick={onPick as never}
    />,
  );

beforeEach(() => {
  mockCatalogProducts = [];
  mockCorrectedTerms = [];
});

describe('MedicationNameSuggestions tier 3', () => {
  it('offers catalog products under their own heading, below everything local', () => {
    mockCatalogProducts = [product('Testosterone'), product('Testosterone enanthate')];
    const { getByText, getByTestId } = renderList('testosterone', [
      medication('Testosterone gel'),
    ]);

    expect(getByText('US drug catalog')).toBeTruthy();
    // Named as someone else's data, not just styled differently.
    expect(getByText('NLM')).toBeTruthy();
    // The user's own row, both catalog rows and the custom row are all present.
    expect(getByTestId('med-suggestion-own:med-Testosterone gel')).toBeTruthy();
    expect(getByTestId('med-suggestion-rxterms:Testosterone (Injectable)')).toBeTruthy();
    expect(getByTestId('med-suggestion-custom')).toBeTruthy();
  });

  it('says nothing about a catalog when the lookup returned none', () => {
    const { queryByText } = renderList('retatrutide');
    expect(queryByText('US drug catalog')).toBeNull();
    expect(queryByText('NLM')).toBeNull();
  });

  it('reports the whole product when one is chosen', () => {
    const onPick = jest.fn();
    const testosterone = product('Testosterone', [
      strength('200 mg/ml Injection 1 ml', 200, 'mg/ml'),
    ]);
    mockCatalogProducts = [testosterone];

    const { getByTestId } = renderList('testosterone', [], onPick);
    fireEvent.press(getByTestId('med-suggestion-rxterms:Testosterone (Injectable)'));

    // The product, not a flattened name: the screen decides which of its fields to apply.
    expect(onPick).toHaveBeenCalledWith({ kind: 'rxterms', product: testosterone });
  });

  it('does not offer a drug the user already has under that name', () => {
    mockCatalogProducts = [product('Testosterone'), product('Testosterone enanthate')];
    const { queryByTestId, getByTestId } = renderList('testosterone', [
      medication('Testosterone'),
    ]);

    // Their own row carries their strength and schedule; a catalog row for the same name is a
    // worse copy of it.
    expect(queryByTestId('med-suggestion-rxterms:Testosterone (Injectable)')).toBeNull();
    expect(
      getByTestId('med-suggestion-rxterms:Testosterone enanthate (Injectable)'),
    ).toBeTruthy();
  });

  it('shows a lone strength outright and counts the rest', () => {
    mockCatalogProducts = [
      product('Levothyroxine', [strength('0.025 mg Tab', 0.025, 'mg')]),
      product('Testosterone', [
        strength('100 mg/ml Injection 1 ml', 100, 'mg/ml'),
        strength('200 mg/ml Injection 1 ml', 200, 'mg/ml'),
      ]),
    ];
    // A term neither the bundled catalog nor the fake cabinet matches, so the only rows are the
    // two above plus the custom one.
    const { getByText } = renderList('zzdrug');
    expect(getByText('0.025 mg')).toBeTruthy();
    expect(getByText('2 strengths')).toBeTruthy();
  });

  it('shows no number for a lone strength the parser refused', () => {
    mockCatalogProducts = [product('Testosterone', [strength('1% Gel', null, null)])];
    const { getByTestId } = renderList('testosterone');
    const row = getByTestId('med-suggestion-rxterms:Testosterone (Injectable)');
    // Nothing invented from a string nobody could read — no number anywhere on the row.
    expect(within(row).queryByText(/\d/)).toBeNull();
  });
});

describe('MedicationNameSuggestions tier 1 ordering', () => {
  it('spends its three rows on the drugs the user actually takes', () => {
    // Four matches, three slots. Alphabetically the one they take every week is last, so before
    // recency ranking it was the one row that got dropped.
    const { getByTestId, queryByTestId } = renderList('t', [
      medication('Tadalafil'),
      medication('Telmisartan'),
      medication('Tetracycline'),
      medication('Tirzepatide', { last_taken_at: '2026-08-24T09:00:00.000Z' }),
    ]);

    expect(getByTestId('med-suggestion-own:med-Tirzepatide')).toBeTruthy();
    expect(queryByTestId('med-suggestion-own:med-Tetracycline')).toBeNull();
  });

  it('keeps a discontinued drug below the active ones', () => {
    const { getAllByTestId } = renderList('t', [
      medication('Tirzepatide', {
        is_active: false,
        last_taken_at: '2026-08-24T09:00:00.000Z',
      }),
      medication('Tesamorelin', { last_taken_at: '2026-01-01T09:00:00.000Z' }),
    ]);

    const own = getAllByTestId(/^med-suggestion-own:/);
    expect(own[0]?.props.testID).toBe('med-suggestion-own:med-Tesamorelin');
  });
});

describe('MedicationNameSuggestions — saying a row is a guess', () => {
  it('names the spellings a tier 3 list was actually found under', () => {
    // Without this the rows read as confirmation that the drug was spelled correctly, and one of
    // them is routinely a different drug: RxNav answers a metformin typo with merbromin.
    mockCatalogProducts = [product('Merbromin'), product('metFORMIN')];
    mockCorrectedTerms = ['merbromin', 'metformin'];

    const { getByText } = renderList('metfromin');

    expect(getByText('Showing results for merbromin, metformin')).toBeTruthy();
  });

  it('says nothing about spelling when the term matched as typed', () => {
    mockCatalogProducts = [product('Testosterone')];
    const { queryByText } = renderList('testosterone');
    expect(queryByText(/Showing results for/)).toBeNull();
  });

  it('labels a near-miss tier 2 group as a guess rather than as known drugs', () => {
    // 'retatrutdie' matches nothing by substring, so `searchCatalog` falls back to its edit
    // distance pass — and the heading has to say that is what happened.
    const { getByText, queryByText } = renderList('retatrutdie');

    expect(getByText('Did you mean')).toBeTruthy();
    expect(queryByText('Known drugs')).toBeNull();
    expect(getByText('Retatrutide')).toBeTruthy();
  });

  it('keeps the ordinary heading for an ordinary match', () => {
    const { getByText, queryByText } = renderList('retatrutide');
    expect(getByText('Known drugs')).toBeTruthy();
    expect(queryByText('Did you mean')).toBeNull();
  });
});
