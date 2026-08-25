import { renderHook, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { useDeleteFood } from '../../src/hooks/useDeleteFood';
import { deleteFood } from '../../src/services/api/foodsApi';
import { favoritesQueryKey, foodVariantsQueryKey, foodsQueryKey } from '../../src/hooks/queryKeys';
import { createTestQueryClient, createQueryWrapper, type QueryClient } from './queryTestUtils';
import { apiError } from '../helpers/apiError';

jest.mock('../../src/services/api/foodsApi', () => ({
  deleteFood: jest.fn(),
}));

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

  test('calls deleteFood with the correct foodId', async () => {
    mockDeleteFood.mockResolvedValue({ message: 'Food deleted permanently.' });

    const { result } = renderHook(
      () => useDeleteFood({ foodId: 'food-123' }),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.confirmAndDelete();
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const deleteButton = alertCall[2].find((btn: any) => btn.text === 'Delete');
    await act(async () => {
      deleteButton.onPress();
    });

    await waitFor(() => {
      expect(mockDeleteFood).toHaveBeenCalledWith('food-123');
    });
  });

  test('calls onSuccess after a successful deletion', async () => {
    mockDeleteFood.mockResolvedValue({ message: 'Food deleted permanently.' });
    const onSuccess = jest.fn();

    const { result } = renderHook(
      () => useDeleteFood({ foodId: 'food-123', onSuccess }),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.confirmAndDelete();
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const deleteButton = alertCall[2].find((btn: any) => btn.text === 'Delete');
    await act(async () => {
      deleteButton.onPress();
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  test('invalidateCaches invalidates food detail and list queries', () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useDeleteFood({ foodId: 'food-123' }),
      { wrapper: createQueryWrapper(queryClient) },
    );

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

    invalidateSpy.mockRestore();
  });

  test('shows a permission toast on 403 errors', async () => {
    mockDeleteFood.mockRejectedValue(apiError(403, 'Forbidden'));

    const { result } = renderHook(
      () => useDeleteFood({ foodId: 'food-123' }),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.confirmAndDelete();
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const deleteButton = alertCall[2].find((btn: any) => btn.text === 'Delete');
    await act(async () => {
      deleteButton.onPress();
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
    mockDeleteFood.mockRejectedValue(apiError(500, 'food 403abc-dead-beef is corrupt'));

    const { result } = renderHook(
      () => useDeleteFood({ foodId: 'food-123' }),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.confirmAndDelete();
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const deleteButton = alertCall[2].find((btn: { text: string }) => btn.text === 'Delete');
    await act(async () => {
      deleteButton.onPress();
    });

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text2: 'Please try again.' }),
      );
    });
  });
});
