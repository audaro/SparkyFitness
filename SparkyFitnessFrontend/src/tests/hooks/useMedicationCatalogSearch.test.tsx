import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MedicationCatalogSearchResponse } from '@workspace/shared';

const mockPreferences = { medicationCatalogLookupEnabled: true };

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => mockPreferences,
}));

const searchMedicationCatalog = jest.fn();
jest.mock('@/api/Medications/medicationService', () => ({
  searchMedicationCatalog: (...args: unknown[]) =>
    searchMedicationCatalog(...args),
}));

import { useMedicationCatalogSearch } from '@/hooks/useMedicationCatalogSearch';

/**
 * The rules this tier is under, expressed as tests.
 *
 * Every one of them is about a request that should not be made, or a row that should not be
 * shown. The lookup sends a medication name to a third party, so "did nothing" is the behaviour
 * with teeth here — which is why most of what follows asserts on the mock NOT being called.
 */

const product = (baseName: string) => ({
  displayName: `${baseName} (Injectable)`,
  baseName,
  doseForm: 'Injectable',
  strengths: [],
});

const answer = (...baseNames: string[]): MedicationCatalogSearchResponse => ({
  products: baseNames.map(product),
  unavailableReason: null,
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const renderSearch = (initialTerm: string) =>
  renderHook(
    ({ term }: { term: string }) =>
      useMedicationCatalogSearch(term, { active: true }),
    { wrapper, initialProps: { term: initialTerm } }
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockPreferences.medicationCatalogLookupEnabled = true;
  searchMedicationCatalog.mockReset();
  searchMedicationCatalog.mockResolvedValue(answer('Testosterone'));
});

afterEach(() => {
  jest.useRealTimers();
});

/** Let the debounce elapse and the resulting query settle. */
const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
};

describe('useMedicationCatalogSearch', () => {
  it('waits for the typing to stop before asking', async () => {
    // Mounted on an empty box, as the add dialog is, and then typed into.
    const { rerender } = renderSearch('');
    rerender({ term: 'tes' });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    rerender({ term: 'test' });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    rerender({ term: 'testo' });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    // Two keystrokes 200 ms apart never settle, so still nothing.
    expect(searchMedicationCatalog).not.toHaveBeenCalled();

    await settle();
    expect(searchMedicationCatalog).toHaveBeenCalledTimes(1);
    expect(searchMedicationCatalog).toHaveBeenCalledWith('testo', undefined);
  });

  it('does not ask about a term too short to be a drug name', async () => {
    renderSearch('te');
    await settle();
    expect(searchMedicationCatalog).not.toHaveBeenCalled();
  });

  it('does not ask at all when the user has not opted in', async () => {
    mockPreferences.medicationCatalogLookupEnabled = false;
    const { result } = renderSearch('testosterone');
    await settle();
    // Not "asks and discards" — the point of the client-side gate is that the name never
    // travels. A server that would have refused anyway is the backstop, not the mechanism.
    expect(searchMedicationCatalog).not.toHaveBeenCalled();
    expect(result.current.products).toEqual([]);
  });

  it('returns what the lookup found', async () => {
    const { result } = renderSearch('testosterone');
    await settle();
    await waitFor(() =>
      expect(result.current.products.map((p) => p.baseName)).toEqual([
        'Testosterone',
      ])
    );
  });

  it('passes the row cap through to the request', async () => {
    renderHook(
      () =>
        useMedicationCatalogSearch('testosterone', { limit: 5, active: true }),
      { wrapper }
    );
    await settle();
    expect(searchMedicationCatalog).toHaveBeenCalledWith('testosterone', 5);
  });

  it('asks nothing while nobody is looking at the suggestions', async () => {
    // The edit dialog mounts with a name already in the box. Nothing is on screen to receive a
    // suggestion, so nothing may be sent to ask for one.
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useMedicationCatalogSearch('testosterone', { active }),
      { wrapper, initialProps: { active: false } }
    );
    await settle();
    expect(searchMedicationCatalog).not.toHaveBeenCalled();

    // Opening the list is the act that makes it a search.
    rerender({ active: true });
    await settle();
    expect(searchMedicationCatalog).toHaveBeenCalledTimes(1);
  });

  it('keeps showing results while the term they answered is still a prefix', async () => {
    const { result, rerender } = renderSearch('testosterone');
    await settle();
    await waitFor(() => expect(result.current.products).toHaveLength(1));

    // Typing on: the rows are a debounce out of date but every one of them still matches what
    // is in the box, so they stay rather than blinking out between keystrokes.
    rerender({ term: 'testosterone c' });
    expect(result.current.products).toHaveLength(1);
  });

  it('drops results the moment they stop matching what is typed', async () => {
    const { result, rerender } = renderSearch('testosterone');
    await settle();
    await waitFor(() => expect(result.current.products).toHaveLength(1));

    // Cleared the box to start a different drug. Leaving testosterone rows under "levo" would be
    // offering a medication the user is not looking at.
    rerender({ term: 'levo' });
    expect(result.current.products).toEqual([]);
  });

  it('reports no products, and no error, when the lookup fails', async () => {
    searchMedicationCatalog.mockRejectedValue(new Error('backend down'));
    const { result } = renderSearch('testosterone');
    await settle();
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    // No error field to inspect on purpose: tier 3 has no failure the user is told about.
    expect(result.current.products).toEqual([]);
  });

  it('does not retry a failed lookup', async () => {
    searchMedicationCatalog.mockRejectedValue(new Error('backend down'));
    const { result } = renderSearch('testosterone');
    await settle();
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(searchMedicationCatalog).toHaveBeenCalledTimes(1);
  });

  it('asks once for the same name in either case', async () => {
    const { rerender } = renderSearch('Metformin');
    await settle();
    expect(searchMedicationCatalog).toHaveBeenCalledTimes(1);

    rerender({ term: 'metformin' });
    await settle();
    // Same cache entry: RxTerms does not care about case and neither should the wire.
    expect(searchMedicationCatalog).toHaveBeenCalledTimes(1);
  });
});
