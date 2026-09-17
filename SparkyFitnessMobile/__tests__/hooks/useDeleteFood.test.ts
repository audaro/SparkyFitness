import { renderHook, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { useDeleteFood } from '../../src/hooks/useDeleteFood';
import { deleteFood } from '../../src/services/api/foodsApi';
import {
  dailySummaryRootQueryKey,
  favoritesQueryKey,
  foodVariantsQueryKey,
  foodsQueryKey,
  mealPlansQueryKey,
  mealsQueryKey,
} from '../../src/hooks/queryKeys';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';
import { apiError } from '../helpers/apiError';

jest.mock('../../src/services/api/foodsApi', () => ({
  deleteFood: jest.fn(),
  getFoodDeletionImpact: jest.fn(),
}));

const impact = {
  foodEntriesCount: 4,
  mealFoodsCount: 1,
  mealPlansCount: 0,
  mealPlanTemplateAssignmentsCount: 0,
  totalReferences: 5,
  otherUserReferences: 0,
};

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const mockDeleteFood = deleteFood as jest.MockedFunction<typeof deleteFood>;

describe('useDeleteFood', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  test('offers hide, delete and delete-with-history when only this user uses it', () => {
    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    const options = result.current.buildDeleteOptions(impact);

    expect(options.map((o) => o.mode)).toEqual([
      'hide',
      'delete',
      'delete_with_history',
    ]);
    // Only the history-destroying option is styled as destructive.
    expect(options.map((o) => o.destructive)).toEqual([false, false, true]);
  });

  test('offers hide only when other users reference the food', () => {
    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    // Meals and meal plans cascade globally, so deleting would reach into other
    // people's data. Hiding is the only choice that leaves them alone.
    expect(
      result.current
        .buildDeleteOptions({ ...impact, otherUserReferences: 3 })
        .map((o) => o.mode)
    ).toEqual(['hide']);
  });

  test('offers hide only while the impact is still unknown', () => {
    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    // Guessing "nobody else uses it" is the one wrong guess that damages
    // another person's data, so an unresolved impact must not offer delete.
    expect(result.current.buildDeleteOptions(null).map((o) => o.mode)).toEqual([
      'hide',
    ]);
  });

  test('deletes without confirmation but keeps history', async () => {
    mockDeleteFood.mockResolvedValue({ message: 'Food deleted permanently.' });
    const onSuccess = jest.fn();

    const { result } = renderHook(
      () => useDeleteFood({ foodId: 'food-123', onSuccess }),
      { wrapper: createQueryWrapper(queryClient) }
    );

    const options = result.current.buildDeleteOptions(impact);
    await act(async () => {
      options.find((o) => o.mode === 'delete')!.onSelect();
    });

    await waitFor(() => {
      expect(mockDeleteFood).toHaveBeenCalledWith('food-123', 'delete');
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('confirms separately before deleting logged entries', async () => {
    mockDeleteFood.mockResolvedValue({ message: 'ok' });

    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    const options = result.current.buildDeleteOptions(impact);
    act(() => {
      options.find((o) => o.mode === 'delete_with_history')!.onSelect();
    });

    // Picking it must not fire the request on its own.
    expect(mockDeleteFood).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete entries too?',
      expect.stringContaining('cannot be undone'),
      expect.any(Array)
    );

    const alertButtons = (Alert.alert as jest.Mock).mock.calls[0][2];
    await act(async () => {
      alertButtons
        .find((btn: { text: string }) => btn.text === 'Delete')
        .onPress();
    });

    await waitFor(() => {
      expect(mockDeleteFood).toHaveBeenCalledWith(
        'food-123',
        'delete_with_history'
      );
    });
  });

  test('reports a server-side downgrade to hidden', async () => {
    mockDeleteFood.mockResolvedValue({ message: 'ok', status: 'hidden' });

    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    const options = result.current.buildDeleteOptions(impact);
    await act(async () => {
      options.find((o) => o.mode === 'delete')!.onSelect();
    });

    // The server hides instead of deleting when someone else still uses it;
    // saying "deleted" would be a lie the user could act on.
    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Food hidden' })
      );
    });
  });

  test('invalidateCaches invalidates food detail and list queries', () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    act(() => {
      result.current.invalidateCaches();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: foodVariantsQueryKey('food-123'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: foodsQueryKey,
      refetchType: 'all',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['foodsLibrary'],
      refetchType: 'all',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['foodSearch'],
      refetchType: 'all',
    });
    // Regression: a deleted food is cascade-removed from food_favorites, so the
    // separate favorites cache must refetch or it lingers in the Favorites section.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: favoritesQueryKey,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: mealsQueryKey,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: mealPlansQueryKey,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dailySummaryRootQueryKey,
    });

    invalidateSpy.mockRestore();
  });

  test('shows a permission toast on 403 errors', async () => {
    mockDeleteFood.mockRejectedValue(apiError(403, 'Forbidden'));

    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    const options = result.current.buildDeleteOptions(impact);
    await act(async () => {
      options.find((o) => o.mode === 'delete')!.onSelect();
    });

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith({
        type: 'error',
        text1: 'Failed to delete food',
        text2: "You don't have permission to delete this food.",
      });
    });
  });

  test('a non-403 whose body merely contains "403" is not a permission error', async () => {
    // The classifier reads ApiError.statusCode. It used to match the digits in
    // the message `apiClient` builds as `Server error: ${status} - ${body}`, so
    // a body carrying them told the user a food they own was not theirs.
    mockDeleteFood.mockRejectedValue(
      apiError(500, 'food 403abc-dead-beef is corrupt')
    );

    const { result } = renderHook(() => useDeleteFood({ foodId: 'food-123' }), {
      wrapper: createQueryWrapper(queryClient),
    });

    const options = result.current.buildDeleteOptions(impact);
    await act(async () => {
      options.find((o) => o.mode === 'delete')!.onSelect();
    });

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text2: 'Please try again.' })
      );
    });
  });
});
