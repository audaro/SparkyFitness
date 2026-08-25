import React from 'react';
import { Switch } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MedicationSettingsScreen from '../../src/screens/MedicationSettingsScreen';
import * as preferencesApi from '../../src/services/api/preferencesApi';
import { preferencesQueryKey } from '../../src/hooks/queryKeys';

/**
 * The consent surface for tier 3. The switch has to say what it sends before it is flipped, and
 * it has to read false whenever the server has not said otherwise.
 */

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigation = { goBack: jest.fn(), setOptions: jest.fn(), navigate: jest.fn() } as never;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const renderScreen = (initialPrefs: Record<string, unknown> | undefined) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (initialPrefs) queryClient.setQueryData(preferencesQueryKey, initialPrefs);
  return render(
    <QueryClientProvider client={queryClient}>
      <MedicationSettingsScreen
        navigation={mockNavigation}
        route={{ key: 'k', name: 'MedicationSettings', params: undefined } as never}
      />
    </QueryClientProvider>,
  );
};

describe('MedicationSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('says what the lookup sends and where it goes', () => {
    const { getByText } = renderScreen({});
    expect(getByText('Search the US drug catalog')).toBeTruthy();
    expect(getByText(/US National Library of Medicine/)).toBeTruthy();
    // The half that says what does *not* travel matters as much as the half that does.
    expect(getByText(/searched offline either way/)).toBeTruthy();
  });

  it('reads off while the preferences are still loading', () => {
    const { UNSAFE_getAllByType } = renderScreen(undefined);
    // A switch drawn on before the answer arrives is claiming consent nobody gave.
    expect(UNSAFE_getAllByType(Switch)[0]?.props.value).toBe(false);
  });

  it('reflects an opted-in account', () => {
    const { UNSAFE_getAllByType } = renderScreen({
      medication_catalog_lookup_enabled: true,
    });
    expect(UNSAFE_getAllByType(Switch)[0]?.props.value).toBe(true);
  });

  it('saves the opt-in when the switch is flipped', async () => {
    const spy = jest
      .spyOn(preferencesApi, 'updatePreferences')
      .mockResolvedValue({ medication_catalog_lookup_enabled: true } as never);
    const { UNSAFE_getAllByType } = renderScreen({
      medication_catalog_lookup_enabled: false,
    });

    fireEvent(UNSAFE_getAllByType(Switch)[0], 'valueChange', true);

    await waitFor(() =>
      // Only this key: the server merges a partial payload, and resending the rest would clobber
      // a preference changed elsewhere.
      expect(spy).toHaveBeenCalledWith({ medication_catalog_lookup_enabled: true }),
    );
  });

  it('moves at once, then puts the switch back when the save fails', async () => {
    // Held open so the optimistic state can be observed before the failure lands — otherwise a
    // switch that never moved at all would pass this test.
    let fail: (error: Error) => void = () => {};
    jest
      .spyOn(preferencesApi, 'updatePreferences')
      .mockReturnValue(new Promise((_resolve, reject) => {
        fail = reject;
      }) as never);
    const { UNSAFE_getAllByType } = renderScreen({
      medication_catalog_lookup_enabled: false,
    });

    fireEvent(UNSAFE_getAllByType(Switch)[0], 'valueChange', true);
    await waitFor(() => expect(UNSAFE_getAllByType(Switch)[0]?.props.value).toBe(true));

    fail(new Error('server down'));

    // A switch reporting a state the server did not record is the worst kind of wrong here: the
    // user would believe lookups were on when nothing had been saved.
    await waitFor(() => expect(UNSAFE_getAllByType(Switch)[0]?.props.value).toBe(false));
  });
});
