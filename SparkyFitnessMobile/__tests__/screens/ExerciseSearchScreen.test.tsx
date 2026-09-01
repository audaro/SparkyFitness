import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import ExerciseSearchScreen from '../../src/screens/ExerciseSearchScreen';
import {
  useExerciseSearch,
  useExternalProviders,
  useProfile,
  useServerConnection,
  useSuggestedExercises,
} from '../../src/hooks';
import { useExternalExerciseSearch } from '../../src/hooks/useExternalExerciseSearch';
import { useExerciseAlternatives } from '../../src/hooks/useWorkoutRecommendation';
import { fetchExerciseById } from '../../src/services/api/exerciseApi';
import { useNavigationActionGuard } from '../../src/hooks/useNavigationActionGuard';
import { importExercise } from '../../src/services/api/externalExerciseSearchApi';
import {
  useAppPreferencesStore,
  __resetAppPreferencesStoreForTests,
} from '../../src/stores/appPreferencesStore';
import type { Exercise } from '../../src/types/exercise';
import type { ExternalExerciseItem } from '../../src/types/externalExercises';
import { pressHeaderMenuAction } from './helpers/nativeHeaderTestUtils';

jest.mock('../../src/hooks', () => ({
  useExerciseSearch: jest.fn(),
  useExternalProviders: jest.fn(),
  useProfile: jest.fn(() => ({ profile: undefined, isLoading: false })),
  useServerConnection: jest.fn(),
  useSuggestedExercises: jest.fn(),
}));

jest.mock('../../src/hooks/useExternalExerciseSearch', () => ({
  useExternalExerciseSearch: jest.fn(),
}));

jest.mock('../../src/hooks/useNavigationActionGuard', () => ({
  useNavigationActionGuard: jest.fn(),
}));

jest.mock('../../src/hooks/useWorkoutRecommendation', () => ({
  useExerciseAlternatives: jest.fn(),
}));

// Keep transformExerciseRow real — the external import path below depends on it.
jest.mock('../../src/services/api/exerciseApi', () => ({
  ...jest.requireActual('../../src/services/api/exerciseApi'),
  fetchExerciseById: jest.fn(),
}));

// Keep the real isImportableExerciseSource so the nutritionix exclusion is
// tested against the actual source list, but stub the network import.
jest.mock('../../src/services/api/externalExerciseSearchApi', () => ({
  ...jest.requireActual('../../src/services/api/externalExerciseSearchApi'),
  importExercise: jest.fn(),
}));

jest.mock('../../src/services/storage', () => ({
  getActiveServerConfig: jest.fn(),
  proxyHeadersToRecord: jest.fn(() => ({})),
}));

// Native-header path on both jest platforms, so the ownership filter menu is
// mirrored into navigation.setOptions where pressHeaderMenuAction can reach it.
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => true,
  useNativeIOSTabsActive: () => false,
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

jest.mock('../../src/hooks/useExerciseImageSource', () => ({
  useExerciseImageSource: jest.fn(() => ({
    getImageSource: jest.fn((path: string) => ({ uri: path, headers: {} })),
  })),
}));

jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => <View testID={`icon-${props.name}`} />,
  };
});

jest.mock('../../src/components/SafeImage', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) =>
      props.source ? <View testID="row-thumbnail" /> : (props.fallback ?? null),
  };
});

const mockNavigation = {
  setOptions: jest.fn(),
  navigate: jest.fn(),
  goBack: jest.fn(),
  dispatch: jest.fn(),
  isFocused: jest.fn(() => true),
  addListener: jest.fn(() => jest.fn()),
} as any;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const mockUseServerConnection = useServerConnection as jest.MockedFunction<
  typeof useServerConnection
>;
const mockUseProfile = useProfile as jest.MockedFunction<typeof useProfile>;
const mockUseSuggestedExercises = useSuggestedExercises as jest.MockedFunction<
  typeof useSuggestedExercises
>;
const mockUseExerciseSearch = useExerciseSearch as jest.MockedFunction<
  typeof useExerciseSearch
>;
const mockUseExternalProviders = useExternalProviders as jest.MockedFunction<
  typeof useExternalProviders
>;
const mockUseExternalExerciseSearch =
  useExternalExerciseSearch as jest.MockedFunction<typeof useExternalExerciseSearch>;
const mockUseNavigationActionGuard =
  useNavigationActionGuard as jest.MockedFunction<typeof useNavigationActionGuard>;
const mockImportExercise = importExercise as jest.MockedFunction<
  typeof importExercise
>;
const mockUseExerciseAlternatives = useExerciseAlternatives as jest.MockedFunction<
  typeof useExerciseAlternatives
>;
const mockFetchExerciseById = fetchExerciseById as jest.MockedFunction<
  typeof fetchExerciseById
>;

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const localExercise: Exercise = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Bench Press',
  category: 'Strength',
  equipment: ['barbell'],
  primary_muscles: ['chest'],
  secondary_muscles: [],
  calories_per_hour: 300,
  source: 'sparky',
  images: [],
  tags: [],
};

const wgerItem: ExternalExerciseItem = {
  id: '123',
  name: 'Wger Squat',
  category: 'Legs',
  calories_per_hour: 0,
  source: 'wger',
  description: 'Stand with the bar on your back.',
  instructions: ['Stand with the bar on your back.', 'Squat down.'],
  equipment: ['barbell'],
  primary_muscles: ['quadriceps'],
  secondary_muscles: ['glutes'],
  images: ['https://wger.de/media/squat.png'],
};

const nutritionixItem: ExternalExerciseItem = {
  id: 'nx-1',
  name: 'Running',
  category: 'External',
  calories_per_hour: 600,
  source: 'nutritionix',
};

let queryClient: QueryClient;

const renderScreen = (extraParams: Record<string, unknown> = {}) => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const route = {
    key: 'ExerciseSearch-key',
    name: 'ExerciseSearch' as const,
    params: { returnKey: 'workout-form-key', ...extraParams },
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={{ insets, frame }}>
        <ExerciseSearchScreen navigation={mockNavigation} route={route as any} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
};

const openOnlineTab = (screen: ReturnType<typeof renderScreen>) => {
  fireEvent.press(screen.getByText('Online'));
};

describe('ExerciseSearchScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppPreferencesStoreForTests();
    mockUseProfile.mockReturnValue({ profile: { id: 'user-1' }, isLoading: false } as any);
    mockNavigation.isFocused.mockReturnValue(true);
    mockUseServerConnection.mockReturnValue({
      isConnected: true,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    mockUseSuggestedExercises.mockReturnValue({
      recentExercises: [localExercise],
      topExercises: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as any);
    mockUseExerciseSearch.mockReturnValue({
      searchResults: [],
      isSearching: false,
      isSearchActive: false,
      isSearchError: false,
    } as any);
    mockUseExternalProviders.mockReturnValue({
      providers: [
        { id: 'p1', provider_name: 'Wger', provider_type: 'wger' },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as any);
    mockUseExternalExerciseSearch.mockReturnValue({
      searchResults: [wgerItem, nutritionixItem],
      isSearching: false,
      isSearchActive: true,
      isSearchError: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
    } as any);
    mockUseExerciseAlternatives.mockReturnValue({
      alternatives: [],
      isLoading: false,
      isError: false,
    });
    mockUseNavigationActionGuard.mockReturnValue({
      isNavigationLocked: false,
      runNavigationAction: jest.fn((action: () => void) => {
        action();
        return true;
      }),
    });
  });

  describe('local rows', () => {
    it('selects the exercise and goes back on row tap', () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByText('Bench Press'));

      expect(mockNavigation.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_PARAMS',
          payload: expect.objectContaining({
            params: expect.objectContaining({
              selectedExercise: expect.objectContaining({ id: localExercise.id }),
              selectionNonce: expect.any(Number),
            }),
          }),
          source: 'workout-form-key',
        }),
      );
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });

    it('opens the pre-add preview from the info button without selecting', () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByLabelText('View exercise details'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
        item: expect.objectContaining({ id: localExercise.id }),
        hideWorkoutActions: true,
        selectionReturnKey: 'workout-form-key',
      });
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      expect(mockNavigation.goBack).not.toHaveBeenCalled();
      expect(mockImportExercise).not.toHaveBeenCalled();
    });

    it('opens the pre-add preview from the thumbnail without selecting', () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('exercise-thumbnail'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
        item: expect.objectContaining({ id: localExercise.id }),
        hideWorkoutActions: true,
        selectionReturnKey: 'workout-form-key',
      });
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      expect(mockImportExercise).not.toHaveBeenCalled();
    });

    it('does not open the preview while navigation is locked', () => {
      mockUseNavigationActionGuard.mockReturnValue({
        isNavigationLocked: true,
        runNavigationAction: jest.fn(),
      });
      const screen = renderScreen();

      fireEvent.press(screen.getByLabelText('View exercise details'));

      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });
  });

  describe('ownership filter', () => {
    it('persists a filter chosen from the header menu and filters local rows', () => {
      mockUseSuggestedExercises.mockReturnValue({
        recentExercises: [
          { ...localExercise, userId: 'user-1' } as Exercise,
          {
            ...localExercise,
            id: 'ex-2',
            name: 'Community Squat',
            sharedWithPublic: true,
          } as Exercise,
        ],
        topExercises: [],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
      } as any);

      const screen = renderScreen();
      expect(screen.getByText('Community Squat')).toBeTruthy();

      pressHeaderMenuAction(mockNavigation, 'Mine');

      expect(useAppPreferencesStore.getState().exerciseSearchOwnershipFilter).toBe('mine');
      expect(screen.getByText('Bench Press')).toBeTruthy();
      expect(screen.queryByText('Community Squat')).toBeNull();
    });

    it('names the filter and offers Show All when it empties the suggestions', () => {
      useAppPreferencesStore.setState({ exerciseSearchOwnershipFilter: 'public' });

      const screen = renderScreen();

      expect(screen.getByText('No exercises in Public')).toBeTruthy();

      fireEvent.press(screen.getByText('Show All'));

      expect(useAppPreferencesStore.getState().exerciseSearchOwnershipFilter).toBe('all');
      expect(screen.getByText('Bench Press')).toBeTruthy();
    });
  });

  describe('online rows', () => {
    it('renders a thumbnail when the item has images', () => {
      const screen = renderScreen();
      openOnlineTab(screen);

      expect(screen.getByText('Wger Squat')).toBeTruthy();
      expect(screen.getByTestId('row-thumbnail')).toBeTruthy();
    });

    it('imports and selects on row tap', async () => {
      const imported = { ...localExercise, id: 'imported-uuid', name: 'Wger Squat' };
      mockImportExercise.mockResolvedValue(imported);
      const screen = renderScreen();
      openOnlineTab(screen);

      fireEvent.press(screen.getByText('Wger Squat'));

      await waitFor(() =>
        expect(mockNavigation.dispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'SET_PARAMS',
            payload: expect.objectContaining({
              params: expect.objectContaining({
                selectedExercise: expect.objectContaining({ id: 'imported-uuid' }),
              }),
            }),
            source: 'workout-form-key',
          }),
        ),
      );
      expect(mockImportExercise).toHaveBeenCalledWith('wger', '123');
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });

    it('opens the preview with the mapped exercise and forwards selectionReturnKey for an importable source', () => {
      const screen = renderScreen();
      openOnlineTab(screen);

      const infoButtons = screen.getAllByLabelText('View exercise details');
      fireEvent.press(infoButtons[0]);

      expect(mockNavigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
        item: expect.objectContaining({
          id: '123',
          name: 'Wger Squat',
          source: 'wger',
          equipment: ['barbell'],
          primary_muscles: ['quadriceps'],
          instructions: ['Stand with the bar on your back.', 'Squat down.'],
          images: ['https://wger.de/media/squat.png'],
        }),
        hideWorkoutActions: true,
        selectionReturnKey: 'workout-form-key',
      });
      expect(mockImportExercise).not.toHaveBeenCalled();
    });

    it('opens the preview from the thumbnail without importing', () => {
      const screen = renderScreen();
      openOnlineTab(screen);

      fireEvent.press(screen.getAllByTestId('exercise-thumbnail')[0]);

      expect(mockNavigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
        item: expect.objectContaining({ id: '123', name: 'Wger Squat', source: 'wger' }),
        hideWorkoutActions: true,
        selectionReturnKey: 'workout-form-key',
      });
      expect(mockImportExercise).not.toHaveBeenCalled();
    });

    it('omits selectionReturnKey when previewing a non-importable source', () => {
      const screen = renderScreen();
      openOnlineTab(screen);

      const infoButtons = screen.getAllByLabelText('View exercise details');
      fireEvent.press(infoButtons[1]);

      expect(mockNavigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
        item: expect.objectContaining({ id: 'nx-1', source: 'nutritionix' }),
        hideWorkoutActions: true,
      });
      const params = mockNavigation.navigate.mock.calls[0][1];
      expect('selectionReturnKey' in params).toBe(false);
    });

    it('disables the info buttons while an import is in flight', async () => {
      let resolveImport!: (exercise: Exercise) => void;
      mockImportExercise.mockImplementation(
        () => new Promise((resolve) => { resolveImport = resolve; }),
      );
      const screen = renderScreen();
      openOnlineTab(screen);

      fireEvent.press(screen.getByText('Wger Squat'));
      fireEvent.press(screen.getAllByLabelText('View exercise details')[0]);

      expect(mockNavigation.navigate).not.toHaveBeenCalled();

      await act(async () => {
        resolveImport({ ...localExercise, id: 'imported-uuid' });
      });
    });

    it('imports only once on a rapid double tap', async () => {
      let resolveImport!: (exercise: Exercise) => void;
      mockImportExercise.mockImplementation(
        () => new Promise((resolve) => { resolveImport = resolve; }),
      );
      const screen = renderScreen();
      openOnlineTab(screen);

      fireEvent.press(screen.getByText('Wger Squat'));
      fireEvent.press(screen.getByText('Wger Squat'));

      expect(mockImportExercise).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveImport({ ...localExercise, id: 'imported-uuid' });
      });
    });

    it('does not select or go back when focus is lost during the import', async () => {
      mockImportExercise.mockResolvedValue({ ...localExercise, id: 'imported-uuid' });
      mockNavigation.isFocused.mockReturnValue(false);
      const invalidateSpy = jest.fn();
      const screen = renderScreen();
      queryClient.invalidateQueries = invalidateSpy;
      openOnlineTab(screen);

      fireEvent.press(screen.getByText('Wger Squat'));

      await waitFor(() => expect(mockImportExercise).toHaveBeenCalled());
      await act(async () => {});
      // The import still landed server-side, so the library cache refresh
      // must run even though the selection was abandoned.
      expect(invalidateSpy).toHaveBeenCalled();
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      expect(mockNavigation.goBack).not.toHaveBeenCalled();
    });

    it('shows a toast on import failure and allows a retry', async () => {
      mockImportExercise.mockRejectedValueOnce(new Error('boom'));
      const screen = renderScreen();
      openOnlineTab(screen);

      fireEvent.press(screen.getByText('Wger Squat'));

      await waitFor(() =>
        expect(Toast.show).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error', text1: 'Failed to add exercise' }),
        ),
      );
      expect(mockNavigation.goBack).not.toHaveBeenCalled();

      // The in-flight guard must clear on failure, so a retry can succeed.
      mockImportExercise.mockResolvedValueOnce({ ...localExercise, id: 'imported-uuid' });
      fireEvent.press(screen.getByText('Wger Squat'));

      await waitFor(() => expect(mockNavigation.goBack).toHaveBeenCalled());
      expect(mockImportExercise).toHaveBeenCalledTimes(2);
    });
  });

  describe('suggested replacements', () => {
    const SOURCE_ID = '99999999-9999-4999-8999-999999999999';
    const localAlternative = {
      exercise_id: '22222222-2222-4222-8222-222222222222',
      exercise_name: 'Cable Fly',
      source: 'local' as const,
      primary_muscles: ['chest'],
      secondary_muscles: [],
      equipment: ['cable'],
      images: [],
      mechanic: 'isolation',
      level: 'beginner',
      score: 5,
    };
    const externalAlternative = {
      ...localAlternative,
      exercise_id: 'Chest_Dip',
      exercise_name: 'Chest Dip',
      source: 'external' as const,
      equipment: ['body only'],
    };

    const fullCableFly: Exercise = {
      ...localExercise,
      id: localAlternative.exercise_id,
      name: 'Cable Fly',
    };

    it('asks for nothing when the screen was opened to add, not replace', () => {
      const screen = renderScreen();

      expect(mockUseExerciseAlternatives).toHaveBeenCalledWith(undefined);
      expect(screen.queryByTestId('suggested-section')).toBeNull();
    });

    it('lists the ranked alternatives above the library', () => {
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [localAlternative, externalAlternative],
        isLoading: false,
        isError: false,
      });

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });

      expect(mockUseExerciseAlternatives).toHaveBeenCalledWith(SOURCE_ID);
      expect(screen.getByTestId('suggested-section')).toBeTruthy();
      expect(screen.getByText('Suggested')).toBeTruthy();
      expect(screen.getByText('Cable Fly')).toBeTruthy();
      // Equipment for a row already in the library, and a plain hint for one
      // that still has to be imported.
      expect(screen.getByText('Cable')).toBeTruthy();
      expect(screen.getByText('Not in your library yet')).toBeTruthy();
    });

    it('fetches a local suggestion in full before returning it', async () => {
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [localAlternative],
        isLoading: false,
        isError: false,
      });
      mockFetchExerciseById.mockResolvedValue(fullCableFly);

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });
      await act(async () => {
        fireEvent.press(screen.getByText('Cable Fly'));
      });

      // The ranked row carries no category, modality or calorie rate, and the
      // caller snapshots whatever it is handed — so it is fetched, not rebuilt.
      expect(mockFetchExerciseById).toHaveBeenCalledWith(localAlternative.exercise_id);
      expect(mockNavigation.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            params: expect.objectContaining({
              selectedExercise: expect.objectContaining({
                id: fullCableFly.id,
                calories_per_hour: 300,
              }),
            }),
          }),
        }),
      );
      await waitFor(() => expect(mockNavigation.goBack).toHaveBeenCalled());
    });

    it('imports an external suggestion from free-exercise-db first', async () => {
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [externalAlternative],
        isLoading: false,
        isError: false,
      });
      mockImportExercise.mockResolvedValue(fullCableFly);

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });
      await act(async () => {
        fireEvent.press(screen.getByText('Chest Dip'));
      });

      // The server only ever reaches free-exercise-db for these, so the source
      // is fixed rather than carried on the row.
      expect(mockImportExercise).toHaveBeenCalledWith('free-exercise-db', 'Chest_Dip');
      expect(mockFetchExerciseById).not.toHaveBeenCalled();
      await waitFor(() => expect(mockNavigation.goBack).toHaveBeenCalled());
    });

    it('stops a library row being selected while a suggestion is still resolving', async () => {
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [localAlternative],
        isLoading: false,
        isError: false,
      });
      // Never settles: the tap below lands mid-resolve, which is the whole
      // point. Suggested rows sit directly above the library ones, so this is
      // an ordinary mis-tap, and selecting is synchronous — an un-guarded row
      // would dispatch a second exercise for the same slot.
      mockFetchExerciseById.mockReturnValue(new Promise<never>(() => {}));

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });
      fireEvent.press(screen.getByText('Cable Fly'));
      await act(async () => {});
      fireEvent.press(screen.getByText('Bench Press'));

      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      expect(mockNavigation.goBack).not.toHaveBeenCalled();
    });

    it('keeps the shortlist on screen when the library has nothing to show', () => {
      mockUseSuggestedExercises.mockReturnValue({
        recentExercises: [],
        topExercises: [],
        isLoading: false,
        isError: true,
        refetch: jest.fn(),
      } as any);
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [localAlternative],
        isLoading: false,
        isError: false,
      });

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });

      // A failed library read used to take the whole tab; the suggestions are
      // fetched separately and are the reason the user is here.
      expect(screen.getByTestId('suggested-section')).toBeTruthy();
      expect(screen.queryByText('Failed to load exercises')).toBeNull();
    });

    it('keeps the shortlist reachable when a typed search finds nothing', () => {
      mockUseExerciseSearch.mockReturnValue({
        searchResults: [],
        isSearching: false,
        isSearchActive: true,
        isSearchError: false,
      } as any);
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [localAlternative],
        isLoading: false,
        isError: false,
      });

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });

      expect(screen.getByTestId('suggested-section')).toBeTruthy();
      // The empty state moves inside the list rather than replacing it.
      expect(screen.getByText('No matching exercises found')).toBeTruthy();
    });

    it('falls back to a plain search when the lookup fails', () => {
      mockUseExerciseAlternatives.mockReturnValue({
        alternatives: [],
        isLoading: false,
        isError: true,
      });

      const screen = renderScreen({ suggestForExerciseId: SOURCE_ID });

      expect(screen.queryByTestId('suggested-section')).toBeNull();
      expect(screen.getByText('Bench Press')).toBeTruthy();
    });
  });
});
