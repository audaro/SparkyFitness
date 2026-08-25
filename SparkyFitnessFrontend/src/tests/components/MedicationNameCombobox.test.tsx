import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { RxTermsProduct } from '@workspace/shared';
import type { Medication } from '@/types/medications';

let ownMedications: Medication[] = [];
let catalogProducts: RxTermsProduct[] = [];

jest.mock('@/hooks/useMedications', () => ({
  useMedications: () => ({ data: ownMedications }),
}));

jest.mock('@/hooks/useMedicationCatalogSearch', () => ({
  useMedicationCatalogSearch: () => ({
    products: catalogProducts,
    isFetching: false,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(opts?.[name] ?? '')
      ),
  }),
}));

import MedicationNameCombobox, {
  type MedicationNamePick,
} from '@/pages/Medications/MedicationNameCombobox';

/**
 * Tier 3 in the dropdown. What is under test is mostly ordering and identity: which rows appear,
 * in what order, under what label — and, in the last case here, what happens to the highlight
 * when a network tier lands rows into a list the user is already arrowing through.
 */

const product = (
  baseName: string,
  strengths: RxTermsProduct['strengths'] = []
): RxTermsProduct => ({
  displayName: `${baseName} (Injectable)`,
  baseName,
  doseForm: 'Injectable',
  strengths,
});

const strength = (
  raw: string,
  value: number | null,
  unit: string | null
): RxTermsProduct['strengths'][number] => ({
  raw,
  rxcui: '12345',
  value,
  unit,
  unparsedReason: value === null ? 'unrecognised' : null,
});

const medication = (name: string): Medication =>
  ({
    id: `med-${name}`,
    name,
    display_name: null,
    strength_value: null,
    strength_unit: null,
  }) as unknown as Medication;

const renderCombobox = (
  value: string,
  onPick: (pick: MedicationNamePick) => void = jest.fn()
) =>
  render(
    <MedicationNameCombobox
      value={value}
      onChange={jest.fn()}
      onPick={onPick}
      inputId="med-name"
    />
  );

const openList = () => {
  fireEvent.focus(screen.getByRole('combobox'));
  return screen.getByRole('listbox');
};

/** The nth row, or a failure that names which row was missing rather than a null dereference. */
const optionAt = (list: HTMLElement, index: number): HTMLElement => {
  const option = within(list).getAllByRole('option')[index];
  if (!option) throw new Error(`no dropdown row at index ${index}`);
  return option;
};

beforeEach(() => {
  ownMedications = [];
  catalogProducts = [];
});

describe('MedicationNameCombobox tier 3', () => {
  it('offers catalog products under their own heading, below everything local', () => {
    ownMedications = [medication('Testosterone gel')];
    catalogProducts = [
      product('Testosterone'),
      product('Testosterone enanthate'),
    ];

    renderCombobox('testosterone');
    const list = openList();

    expect(within(list).getByText('US drug catalog')).toBeInTheDocument();
    // Named as someone else's data, not just styled differently.
    expect(within(list).getByText('NLM')).toBeInTheDocument();

    const options = within(list)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options[0]).toContain('Testosterone gel');
    expect(options[1]).toContain('Testosterone');
    expect(options[2]).toContain('Testosterone enanthate');
    // Still last, as it is for every other tier.
    expect(options[options.length - 1]).toContain('as a custom medication');
  });

  it('says nothing about a catalog when the lookup returned none', () => {
    catalogProducts = [];
    renderCombobox('retatrutide');
    const list = openList();
    expect(within(list).queryByText('US drug catalog')).not.toBeInTheDocument();
    expect(within(list).queryByText('NLM')).not.toBeInTheDocument();
  });

  it('reports the whole product when one is chosen', () => {
    const onPick = jest.fn();
    const testosterone = product('Testosterone', [
      strength('200 mg/ml Injection 1 ml', 200, 'mg/ml'),
    ]);
    catalogProducts = [testosterone];

    renderCombobox('testosterone', onPick);
    const list = openList();
    fireEvent.mouseDown(optionAt(list, 0));

    // The product, not a flattened name: the dialog decides which of its fields to apply.
    expect(onPick).toHaveBeenCalledWith({
      kind: 'rxterms',
      product: testosterone,
    });
  });

  it('does not offer a drug the user already has under that name', () => {
    ownMedications = [medication('Testosterone')];
    catalogProducts = [
      product('Testosterone'),
      product('Testosterone enanthate'),
    ];

    renderCombobox('testosterone');
    const list = openList();

    // Their own row carries their strength and schedule; a catalog row for the same name is a
    // worse copy of it.
    const options = within(list)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(
      options.filter((text) => text?.includes('Testosterone'))
    ).toHaveLength(2);
    expect(options[1]).toContain('Testosterone enanthate');
  });

  it('shows a lone strength outright and counts the rest', () => {
    catalogProducts = [
      product('Levothyroxine', [strength('0.025 mg Tab', 0.025, 'mg')]),
      product('Testosterone', [
        strength('100 mg/ml Injection 1 ml', 100, 'mg/ml'),
        strength('200 mg/ml Injection 1 ml', 200, 'mg/ml'),
      ]),
    ];

    renderCombobox('zzdrug');
    const list = openList();
    expect(optionAt(list, 0).textContent).toContain('0.025 mg');
    expect(optionAt(list, 1).textContent).toContain('2 strengths');
  });

  it('shows no number for a lone strength the parser refused', () => {
    catalogProducts = [
      product('Testosterone', [strength('1% Gel', null, null)]),
    ];
    renderCombobox('testosterone');
    const list = openList();
    // Nothing invented from a string nobody could read.
    expect(optionAt(list, 0).textContent).not.toMatch(/\d/);
  });

  it('moves the highlight when catalog rows arrive under what it points at', () => {
    const onPick = jest.fn();
    const own = medication('Testosterone gel');
    ownMedications = [own];

    const { rerender } = renderCombobox('testosterone', onPick);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    // Two rows so far — their own, then the custom one — and the user arrows down to the custom
    // row, meaning to add the name by hand.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(
      screen.getByRole('option', { selected: true }).textContent
    ).toContain('as a custom medication');

    // The lookup lands and inserts a row at exactly that index, pushing the custom row down.
    catalogProducts = [product('Testosterone')];
    rerender(
      <MedicationNameCombobox
        value="testosterone"
        onChange={jest.fn()}
        onPick={onPick}
        inputId="med-name"
      />
    );

    // Enter must not add a drug the user never chose. Holding the index would now select the
    // catalog row; the highlight resets instead, because the list it belonged to is gone.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ kind: 'existing', medication: own });
  });
});
