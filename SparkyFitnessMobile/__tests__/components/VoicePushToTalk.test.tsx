import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import VoicePushToTalk from '../../src/components/voice/VoicePushToTalk';
import { postQuickLog } from '../../src/services/api/quickLogApi';
import {
  useAppPreferencesStore,
  __resetAppPreferencesStoreForTests,
} from '../../src/stores/appPreferencesStore';

jest.mock('../../src/services/api/quickLogApi', () => ({
  postQuickLog: jest.fn(),
}));

// The overlay reads the root navigation state through ActiveWorkoutBar's
// shared ref; fake a ready navigator sitting on Tabs.
const mockNavigate = jest.fn();
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  navigationRef: {
    isReady: () => true,
    getCurrentRoute: () => ({ name: 'Tabs' }),
    getRootState: () => ({ index: 0, routes: [{ name: 'Tabs' }] }),
    addListener: () => () => {},
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  useActiveWorkoutBarPadding: () => 0,
}));

jest.mock('../../src/hooks', () => ({
  useActiveAiServiceSetting: () => ({ data: { id: 'cfg-1' } }),
}));

const mockPostQuickLog = postQuickLog as jest.MockedFunction<typeof postQuickLog>;

type SpeechHandlers = Record<string, (event: unknown) => void>;
const handlers = (): SpeechHandlers =>
  (global as unknown as { __speechRecognitionHandlers: SpeechHandlers })
    .__speechRecognitionHandlers;

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const renderOverlay = () =>
  render(
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <VoicePushToTalk />
    </SafeAreaProvider>
  );

describe('VoicePushToTalk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppPreferencesStoreForTests();
  });

  it('runs the full listen → send → reply flow', async () => {
    mockPostQuickLog.mockResolvedValueOnce({ text: '✅ Logged 2 eggs.', actions: [] });

    const { getByLabelText, getByText, queryByText } = renderOverlay();

    fireEvent.press(getByLabelText('Talk to Sparky'));
    await waitFor(() =>
      expect(ExpoSpeechRecognitionModule.requestPermissionsAsync).toHaveBeenCalled()
    );
    expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalled();
    expect(getByText('Listening…')).toBeTruthy();

    act(() => {
      handlers().result({ results: [{ transcript: 'log 2 eggs' }], isFinal: true });
    });
    expect(getByText('log 2 eggs')).toBeTruthy();

    await act(async () => {
      handlers().end({});
    });

    expect(mockPostQuickLog).toHaveBeenCalledWith('log 2 eggs', 'cfg-1');
    await waitFor(() => expect(getByText('✅ Logged 2 eggs.')).toBeTruthy());
    // Spoken replies default on: the reply is handed to the synthesizer
    // stripped of the checkmark.
    expect(Speech.speak).toHaveBeenCalledWith(
      'Logged 2 eggs.',
      expect.objectContaining({ onDone: expect.any(Function) })
    );
    expect(queryByText('Listening…')).toBeNull();
  });

  it('does not speak when spoken replies are disabled', async () => {
    useAppPreferencesStore.setState({ voiceRepliesEnabled: false });
    mockPostQuickLog.mockResolvedValueOnce({ text: 'You have 1,450 left.', actions: [] });

    const { getByLabelText, getByText } = renderOverlay();

    fireEvent.press(getByLabelText('Talk to Sparky'));
    await waitFor(() => expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalled());
    act(() => {
      handlers().result({ results: [{ transcript: 'calories left?' }], isFinal: true });
    });
    await act(async () => {
      handlers().end({});
    });

    await waitFor(() => expect(getByText('You have 1,450 left.')).toBeTruthy());
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('returns to idle when recognition ends with no speech', async () => {
    const { getByLabelText, queryByText } = renderOverlay();

    fireEvent.press(getByLabelText('Talk to Sparky'));
    await waitFor(() => expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalled());
    await act(async () => {
      handlers().end({});
    });

    expect(mockPostQuickLog).not.toHaveBeenCalled();
    expect(queryByText('Listening…')).toBeNull();
  });

  it('surfaces quick-log failures as an error card', async () => {
    mockPostQuickLog.mockRejectedValueOnce(new Error('No active AI provider'));

    const { getByLabelText, getByText } = renderOverlay();

    fireEvent.press(getByLabelText('Talk to Sparky'));
    await waitFor(() => expect(ExpoSpeechRecognitionModule.start).toHaveBeenCalled());
    act(() => {
      handlers().result({ results: [{ transcript: 'log lunch' }], isFinal: true });
    });
    await act(async () => {
      handlers().end({});
    });

    await waitFor(() => expect(getByText('No active AI provider')).toBeTruthy());
    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('hides entirely when the preference is off', () => {
    useAppPreferencesStore.setState({ voiceButtonVisible: false });
    const { queryByLabelText } = renderOverlay();
    expect(queryByLabelText('Talk to Sparky')).toBeNull();
  });
});
