import { act, renderHook, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import { useUpdateFoodEntryMeal } from '../../src/hooks/useUpdateFoodEntryMeal';
import { updateFoodEntryMeal } from '../../src/services/api/foodEntryMealsApi';
import { createQueryWrapper, createTestQueryClient } from './queryTestUtils';
import { apiError } from '../helpers/apiError';

jest.mock('../../src/services/api/foodEntryMealsApi', () => ({
  updateFoodEntryMeal: jest.fn(),
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

const mockUpdate = updateFoodEntryMeal as jest.MockedFunction<typeof updateFoodEntryMeal>;
const mockToast = Toast.show as jest.MockedFunction<typeof Toast.show>;

function render() {
  return renderHook(
    () => useUpdateFoodEntryMeal({ mealId: 'meal-1', entryDate: '2026-03-01' }),
    { wrapper: createQueryWrapper(createTestQueryClient()) },
  );
}

const expectMessage = (text2: string) =>
  waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ text2 })));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useUpdateFoodEntryMeal', () => {
  test('a 403 is reported as a permission problem', async () => {
    mockUpdate.mockRejectedValue(apiError(403, 'Forbidden'));

    const { result } = render();
    await act(async () => {
      result.current.updateMeal({} as never);
    });

    await expectMessage("You don't have permission to edit this meal.");
  });

  test('a non-403 whose body merely contains "403" is not a permission problem', async () => {
    // The classifier reads ApiError.statusCode. It used to match the digits in
    // the message `apiClient` builds as `Server error: ${status} - ${body}`, so
    // a body carrying them told the user a meal they own was not theirs.
    mockUpdate.mockRejectedValue(apiError(500, 'meal 403abc-dead-beef is corrupt'));

    const { result } = render();
    await act(async () => {
      result.current.updateMeal({} as never);
    });

    await expectMessage('Please try again.');
  });

  test('a plain Error never classifies — nothing below apiFetch promises an ApiError', async () => {
    mockUpdate.mockRejectedValue(new Error('Server error: 403 - Forbidden'));

    const { result } = render();
    await act(async () => {
      result.current.updateMeal({} as never);
    });

    await expectMessage('Please try again.');
  });

  test('a successful update calls back with the saved meal', async () => {
    const saved = { id: 'meal-1' };
    mockUpdate.mockResolvedValue(saved as never);
    const onSuccess = jest.fn();

    const { result } = renderHook(
      () => useUpdateFoodEntryMeal({ mealId: 'meal-1', entryDate: '2026-03-01', onSuccess }),
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await act(async () => {
      result.current.updateMeal({} as never);
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(saved));
    expect(mockToast).not.toHaveBeenCalled();
  });
});
