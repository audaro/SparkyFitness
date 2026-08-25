import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MedicationCatalogSearchResponse } from '@workspace/shared';
import { useMedicationCatalogSearch } from '../../src/hooks/useMedicationCatalogSearch';
import * as medicationsApi from '../../src/services/api/medicationsApi';
import { preferencesQueryKey } from '../../src/hooks/queryKeys';

/**
 * The rules this tier is under, expressed as tests.
 *
 * Every one of them is about a request that should not be made, or a row that should not be
 * shown. The lookup sends a medication name to a third party, so "did nothing" is the behaviour
 * with teeth here — which is why most of what follows asserts on the API NOT being called.
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

let searchSpy: jest.SpyInstance;

const renderSearch = (
  initialTerm: string,
  options?: { limit?: number; active?: boolean; optedIn?: boolean },
) => {
  const { optedIn = true, ...hookOptions } = options ?? {};
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(preferencesQueryKey, {
    medication_catalog_lookup_enabled: optedIn,
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ term, active }: { term: string; active?: boolean }) =>
      useMedicationCatalogSearch(term, { ...hookOptions, active }),
    { wrapper, initialProps: { term: initialTerm, active: hookOptions.active ?? true } },
  );
};

/**
 * Let the debounce elapse and the resulting query settle.
 *
 * Two acts, not one: the first fires the debounce timer and starts the request, and the second
 * lets the resolved (or rejected) promise reach the query cache and re-render the hook — which
 * needs a tick of its own because the query client batches its notifications on a timer.
 */
const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
};

describe('useMedicationCatalogSearch', () => {
  // Inside the describe, not at file scope, and that placement matters: React Native Testing
  // Library registers its auto-cleanup as a top-level `afterEach`, Jest runs the innermost hooks
  // first, and cleanup deadlocks under fake timers. Declared out here, `useRealTimers` would run
  // second and every test in the file would time out in teardown.
  beforeEach(() => {
    jest.useFakeTimers();
    searchSpy = jest
      .spyOn(medicationsApi, 'searchMedicationCatalog')
      .mockResolvedValue(answer('Testosterone'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits for the typing to stop before asking', async () => {
    // Mounted on an empty field, as the form is, and then typed into.
    const { rerender } = renderSearch('');
    for (const term of ['tes', 'test', 'testo']) {
      rerender({ term, active: true });
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
    }
    // Keystrokes 200 ms apart never settle, so still nothing.
    expect(searchSpy).not.toHaveBeenCalled();

    await settle();
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('testo', undefined);
  });

  it('does not ask about a term too short to be a drug name', async () => {
    renderSearch('te');
    await settle();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('does not ask at all when the user has not opted in', async () => {
    const { result } = renderSearch('testosterone', { optedIn: false });
    await settle();
    // Not "asks and discards" — the point of the client-side gate is that the name never
    // travels. A server that would have refused anyway is the backstop, not the mechanism.
    expect(searchSpy).not.toHaveBeenCalled();
    expect(result.current.products).toEqual([]);
  });

  it('returns what the lookup found', async () => {
    const { result } = renderSearch('testosterone');
    await settle();
    expect(result.current.products.map((p) => p.baseName)).toEqual(['Testosterone']);
  });

  it('passes the row cap through to the request', async () => {
    renderSearch('testosterone', { limit: 5 });
    await settle();
    expect(searchSpy).toHaveBeenCalledWith('testosterone', 5);
  });

  it('asks nothing while nobody is looking at the suggestions', async () => {
    // A form opened on an existing medication has its name in the field already. Nothing is on
    // screen to receive a suggestion, so nothing may be sent to ask for one.
    const { rerender } = renderSearch('testosterone', { active: false });
    await settle();
    expect(searchSpy).not.toHaveBeenCalled();

    // Showing the list is the act that makes it a search.
    rerender({ term: 'testosterone', active: true });
    await settle();
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps showing results while the term they answered is still a prefix', async () => {
    const { result, rerender } = renderSearch('testosterone');
    await settle();
    expect(result.current.products).toHaveLength(1);

    // Typing on: the rows are a debounce out of date but every one of them still matches what
    // is in the field, so they stay rather than blinking out between keystrokes.
    rerender({ term: 'testosterone c', active: true });
    expect(result.current.products).toHaveLength(1);
  });

  it('drops results the moment they stop matching what is typed', async () => {
    const { result, rerender } = renderSearch('testosterone');
    await settle();
    expect(result.current.products).toHaveLength(1);

    // Cleared the field to start a different drug. Leaving testosterone rows under "levo" would
    // be offering a medication the user is not looking at.
    rerender({ term: 'levo', active: true });
    expect(result.current.products).toEqual([]);
  });

  it('reports no products, and no error, when the lookup fails', async () => {
    searchSpy.mockRejectedValue(new Error('backend down'));
    const { result } = renderSearch('testosterone');
    await settle();
    expect(result.current.isFetching).toBe(false);
    // No error field to inspect on purpose: tier 3 has no failure the user is told about.
    expect(result.current.products).toEqual([]);
  });

  it('does not retry a failed lookup', async () => {
    searchSpy.mockRejectedValue(new Error('backend down'));
    const { result } = renderSearch('testosterone');
    await settle();
    expect(result.current.isFetching).toBe(false);
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });

  it('asks once for the same name in either case', async () => {
    const { rerender } = renderSearch('Metformin');
    await settle();
    expect(searchSpy).toHaveBeenCalledTimes(1);

    rerender({ term: 'metformin', active: true });
    await settle();
    // Same cache entry: RxTerms does not care about case and neither should the wire.
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });
});
