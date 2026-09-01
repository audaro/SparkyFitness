import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OpenFdaLookupResponse } from '@workspace/shared';
import MedicationLabelPanel from '../../src/components/medications/MedicationLabelPanel';
import * as medicationsApi from '../../src/services/api/medicationsApi';
import { preferencesQueryKey } from '../../src/hooks/queryKeys';

/**
 * The read-only provenance panel under a saved medication.
 *
 * Most of what follows asserts an *absence*. The panel has four ways to have nothing to show —
 * no RxCUI, not opted in, not listed, FDA unreachable — and in all four the correct UI is no
 * panel at all, not a card explaining why there is no card. It is provenance layered under a
 * record that has already rendered, and the user did not ask for it.
 */

const MEDICATION_ID = 'med-1';

const response = (
  over: Partial<OpenFdaLookupResponse> = {},
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

let labelSpy: jest.SpyInstance;

const renderPanel = (options?: { rxcui?: string | null; optedIn?: boolean }) => {
  const { rxcui = '2601723', optedIn = true } = options ?? {};
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(preferencesQueryKey, {
    medication_catalog_lookup_enabled: optedIn,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MedicationLabelPanel medicationId={MEDICATION_ID} rxcui={rxcui} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  labelSpy = jest
    .spyOn(medicationsApi, 'getMedicationLabel')
    .mockResolvedValue(response());
});

afterEach(() => {
  labelSpy.mockRestore();
});

describe('MedicationLabelPanel', () => {
  it('shows who makes the drug', async () => {
    const { findByText, getByText } = renderPanel();

    expect(await findByText('Eli Lilly and Company')).toBeTruthy();
    expect(getByText('Mounjaro · tirzepatide')).toBeTruthy();
    expect(getByText('Injection, Solution · Subcutaneous')).toBeTruthy();
    expect(getByText('NDC 0002-1434')).toBeTruthy();
  });

  it('names the source, because this is where the user learns a third party was asked', async () => {
    const { findByText } = renderPanel();

    expect(await findByText(/US FDA drug directory/)).toBeTruthy();
  });

  it('says how many listings it is not showing', async () => {
    // A truncated list that says nothing reads as a complete one, which would imply a
    // specificity the data does not have — a generic can be listed by thirty labelers.
    labelSpy.mockResolvedValue(response({ totalMatches: 31 }));

    const { findByText } = renderPanel();

    expect(await findByText(/1 of 31 listings/)).toBeTruthy();
  });

  it('still shows a listing the FDA gave no labeler for', async () => {
    // The NDC identifies the product either way, and it is the one field that always exists.
    labelSpy.mockResolvedValue(
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
      }),
    );

    const { findByText } = renderPanel();

    expect(await findByText('Labeler not stated')).toBeTruthy();
  });

  describe('renders nothing at all', () => {
    it('when the medication has no RxCUI, without asking the server', () => {
      const { toJSON } = renderPanel({ rxcui: null });

      expect(toJSON()).toBeNull();
      expect(labelSpy).not.toHaveBeenCalled();
    });

    it('when the owner has not opted into network drug lookups', () => {
      // The server gate is the binding one; not asking is what keeps the request from happening
      // at all, which is the promise the settings copy makes.
      const { toJSON } = renderPanel({ optedIn: false });

      expect(toJSON()).toBeNull();
      expect(labelSpy).not.toHaveBeenCalled();
    });

    it('when the FDA does not list the drug', async () => {
      labelSpy.mockResolvedValue({
        products: [],
        totalMatches: 0,
        unavailableReason: 'not_found',
      });

      const { toJSON } = renderPanel();

      await waitFor(() => expect(labelSpy).toHaveBeenCalled());
      await waitFor(() => expect(toJSON()).toBeNull());
    });

    it('when the lookup fails', async () => {
      // No toast, no error state, no retry prompt. The medication record has already rendered.
      labelSpy.mockRejectedValue(new Error('backend down'));

      const { toJSON } = renderPanel();

      await waitFor(() => expect(labelSpy).toHaveBeenCalled());
      await waitFor(() => expect(toJSON()).toBeNull());
    });
  });
});
