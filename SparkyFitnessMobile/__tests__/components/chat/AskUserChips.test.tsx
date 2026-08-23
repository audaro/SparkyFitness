import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AskUserChips from '../../../src/components/chat/AskUserChips';
import FoodConfirmCards from '../../../src/components/chat/FoodConfirmCards';
import {
  CONFIRM_FOOD_REJECT_MESSAGE,
  confirmFoodPickMessage,
} from '@workspace/shared';

// Both components read assistant-ui state (message.isLast, thread.isRunning)
// and send replies through aui.thread().append; mock the store surface so the
// tests can drive staleness and capture sends without a live runtime.
const mockAppend = jest.fn();
const mockAuiState = {
  message: { isLast: true },
  thread: { isRunning: false },
};

jest.mock('@assistant-ui/react-native', () => ({
  __esModule: true,
  useAui: () => ({ thread: () => ({ append: mockAppend }) }),
  useAuiState: (selector: (s: typeof mockAuiState) => unknown) => selector(mockAuiState),
}));

beforeEach(() => {
  mockAppend.mockClear();
  mockAuiState.message = { isLast: true };
  mockAuiState.thread = { isRunning: false };
});

const askPart = {
  type: 'tool-call' as const,
  toolCallId: 'call-1',
  toolName: 'sparky_ask_user',
  args: {
    mode: 'ask',
    question: 'How big were the pancakes?',
    options: ['75g each — small', '225g each — large'],
  },
  argsText: '',
};

describe('AskUserChips', () => {
  it('renders the question and one chip per option', () => {
    const { getByText } = render(<AskUserChips part={askPart} />);
    expect(getByText('How big were the pancakes?')).toBeTruthy();
    expect(getByText('75g each — small')).toBeTruthy();
    expect(getByText('225g each — large')).toBeTruthy();
  });

  it('sends the tapped option as an ordinary user message', () => {
    const { getByText } = render(<AskUserChips part={askPart} />);
    fireEvent.press(getByText('75g each — small'));
    expect(mockAppend).toHaveBeenCalledWith('75g each — small');
  });

  // The tool input streams in as partial JSON — a one-item chip row is just a
  // half-built call, not a real question.
  it('renders nothing until at least two options have streamed in', () => {
    const { toJSON } = render(
      <AskUserChips part={{ ...askPart, args: { options: ['75g'] } }} />
    );
    expect(toJSON()).toBeNull();
  });

  // Chips on an older message would re-send a stale answer to a question the
  // chat has moved past.
  it('does not send from a message that is no longer the last one', () => {
    mockAuiState.message = { isLast: false };
    const { getByText } = render(<AskUserChips part={askPart} />);
    fireEvent.press(getByText('75g each — small'));
    expect(mockAppend).not.toHaveBeenCalled();
  });
});

const confirmPart = {
  type: 'tool-call' as const,
  toolCallId: 'call-2',
  toolName: 'sparky_confirm_food',
  args: {
    question: 'Which crackers are these?',
    quantity: 15,
    unit: 'cracker',
    meal_type: 'snacks',
    candidates: [
      {
        label: 'Savory Thins Crackers',
        brand: "Trader Joe's",
        serving_size: 30,
        serving_unit: 'g',
        calories: 130,
        protein: 2,
        carbs: 24,
        fat: 3,
        source: 'openfoodfacts',
        external_id: '00511',
        provider_type: 'openfoodfacts',
      },
      {
        label: 'Water Crackers',
        serving_size: 100,
        serving_unit: 'g',
        calories: 420,
        source: 'internal',
        food_id: 'food-1',
      },
    ],
  },
  argsText: '',
};

describe('FoodConfirmCards', () => {
  it('renders the question, both cards, and their nutrition lines', () => {
    const { getByText } = render(<FoodConfirmCards part={confirmPart} />);
    expect(getByText('Which crackers are these?')).toBeTruthy();
    expect(getByText('Savory Thins Crackers')).toBeTruthy();
    expect(getByText("Trader Joe's")).toBeTruthy();
    expect(getByText('130 Cal per 30 g · P 2g · C 24g · F 3g')).toBeTruthy();
    // Source badges: providers show their type, internal shows "Your foods".
    expect(getByText('openfoodfacts')).toBeTruthy();
    expect(getByText('Your foods')).toBeTruthy();
  });

  it('sends the shared pick message with 1-based numbering on tap', () => {
    const { getByText } = render(<FoodConfirmCards part={confirmPart} />);
    fireEvent.press(getByText('Water Crackers'));
    expect(mockAppend).toHaveBeenCalledWith(
      confirmFoodPickMessage(2, { label: 'Water Crackers' })
    );
  });

  it('sends the shared reject message from "None of these"', () => {
    const { getByText } = render(<FoodConfirmCards part={confirmPart} />);
    fireEvent.press(getByText('None of these'));
    expect(mockAppend).toHaveBeenCalledWith(CONFIRM_FOOD_REJECT_MESSAGE);
  });

  it('renders nothing while no candidate has finished streaming', () => {
    const { toJSON } = render(
      <FoodConfirmCards
        part={{ ...confirmPart, args: { question: 'Which?', candidates: [{ label: 'Half' }] } }}
      />
    );
    expect(toJSON()).toBeNull();
  });

  it('does not send while the thread is still running', () => {
    mockAuiState.thread = { isRunning: true };
    const { getByText } = render(<FoodConfirmCards part={confirmPart} />);
    fireEvent.press(getByText('Water Crackers'));
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
