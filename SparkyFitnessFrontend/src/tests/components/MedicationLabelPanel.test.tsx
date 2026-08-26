import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { OpenFdaLookupResponse } from '@workspace/shared';
import { renderWithClient } from '@/tests/test-utils';
import type { Medication } from '@/types/medications';

const preferences = { medicationCatalogLookupEnabled: true };

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => preferences,
}));

const getMedicationLabel = jest.fn();
jest.mock('@/api/Medications/medicationService', () => ({
  getMedicationLabel: (...args: unknown[]) => getMedicationLabel(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // The panel uses both call shapes: a positional fallback for plain strings and an options
    // object where a count or an NDC has to be interpolated.
    t: (
      _key: string,
      second?: string | Record<string, unknown>
    ): string | undefined => {
      if (typeof second === 'string') return second;
      if (!second) return undefined;
      const template = String(second['defaultValue'] ?? '');
      return template.replace(/{{(\w+)}}/g, (_m, name) =>
        String(second[name] ?? '')
      );
    },
  }),
}));

import MedicationLabelPanel from '@/pages/Medications/MedicationLabelPanel';

/**
 * The read-only provenance panel under a saved medication.
 *
 * Most of what follows asserts an *absence*. The panel has four ways to have nothing to show —
 * no RxCUI, not opted in, not listed, FDA unreachable — and in all four the correct UI is no
 * panel at all, not a card explaining why there is no card. It is provenance layered under a
 * record that has already rendered, and the user did not ask for it.
 */

const medication = (over: Partial<Medication> = {}): Medication =>
  ({
    id: 'med-1',
    name: 'Mounjaro',
    display_name: 'Mounjaro',
    rxnorm_rxcui: '2601723',
    ...over,
  }) as Medication;

const response = (
  over: Partial<OpenFdaLookupResponse> = {}
): OpenFdaLookupResponse => ({
  products: [
    {
      productNdc: '0002-1434',
      labelerName: 'Eli Lilly and Company',
      brandName: 'Mounjaro',
      genericName: 'tirzepatide',
      dosageForm: 'INJECTION, SOLUTION',
      routes: ['SUBCUTANEOUS'],
    },
  ],
  totalMatches: 1,
  unavailableReason: null,
  ...over,
});

beforeEach(() => {
  preferences.medicationCatalogLookupEnabled = true;
  getMedicationLabel.mockReset();
});

describe('MedicationLabelPanel', () => {
  it('shows who makes the drug', async () => {
    getMedicationLabel.mockResolvedValue(response());

    renderWithClient(<MedicationLabelPanel medication={medication()} />);

    expect(
      await screen.findByText('Eli Lilly and Company')
    ).toBeInTheDocument();
    expect(screen.getByText('Mounjaro · tirzepatide')).toBeInTheDocument();
    expect(
      screen.getByText('Injection, Solution · Subcutaneous')
    ).toBeInTheDocument();
    expect(screen.getByText('NDC 0002-1434')).toBeInTheDocument();
  });

  it('names the source, because this is where the user learns a third party was asked', async () => {
    getMedicationLabel.mockResolvedValue(response());

    renderWithClient(<MedicationLabelPanel medication={medication()} />);

    expect(
      await screen.findByText(/US FDA drug directory/)
    ).toBeInTheDocument();
  });

  it('says how many listings it is not showing', async () => {
    // A truncated list that says nothing reads as a complete one, which would imply a
    // specificity the data does not have — a generic can be listed by thirty labelers.
    getMedicationLabel.mockResolvedValue(response({ totalMatches: 31 }));

    renderWithClient(<MedicationLabelPanel medication={medication()} />);

    expect(await screen.findByText(/1 of 31 listings/)).toBeInTheDocument();
  });

  it('still shows a listing the FDA gave no labeler for', async () => {
    // The NDC identifies the product either way, and it is the one field that always exists.
    getMedicationLabel.mockResolvedValue(
      response({
        products: [
          {
            productNdc: '0002-1434',
            labelerName: null,
            brandName: null,
            genericName: null,
            dosageForm: null,
            routes: [],
          },
        ],
      })
    );

    renderWithClient(<MedicationLabelPanel medication={medication()} />);

    expect(await screen.findByText('Labeler not stated')).toBeInTheDocument();
  });

  describe('renders nothing at all', () => {
    it('when the medication has no RxCUI, without asking the server', () => {
      const { container } = renderWithClient(
        <MedicationLabelPanel medication={medication({ rxnorm_rxcui: null })} />
      );

      expect(container).toBeEmptyDOMElement();
      expect(getMedicationLabel).not.toHaveBeenCalled();
    });

    it('when the owner has not opted into network drug lookups', () => {
      // The server gate is the binding one; not asking is what keeps the request from happening
      // at all, which is the promise the settings copy makes.
      preferences.medicationCatalogLookupEnabled = false;

      const { container } = renderWithClient(
        <MedicationLabelPanel medication={medication()} />
      );

      expect(container).toBeEmptyDOMElement();
      expect(getMedicationLabel).not.toHaveBeenCalled();
    });

    it('when the FDA does not list the drug', async () => {
      getMedicationLabel.mockResolvedValue({
        products: [],
        totalMatches: 0,
        unavailableReason: 'not_found',
      });

      const { container } = renderWithClient(
        <MedicationLabelPanel medication={medication()} />
      );

      await waitFor(() => expect(getMedicationLabel).toHaveBeenCalled());
      await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it('when the lookup fails', async () => {
      // No toast, no error state, no retry prompt. The medication record has already rendered.
      getMedicationLabel.mockRejectedValue(new Error('backend down'));

      const { container } = renderWithClient(
        <MedicationLabelPanel medication={medication()} />
      );

      await waitFor(() => expect(getMedicationLabel).toHaveBeenCalled());
      await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
  });
});
