import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import WorkoutTimerSheet from '../../src/components/WorkoutTimerSheet';
import { useNativeIOSTabsActive } from '../../src/services/nativeTabBarPreference';

jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSTabsActive: jest.fn(() => false),
}));

const mockUseNativeIOSTabsActive =
  useNativeIOSTabsActive as jest.MockedFunction<typeof useNativeIOSTabsActive>;

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const TEST_IDS = {
  track: 'timer-progress-track',
  fill: 'timer-progress-fill',
  countdown: 'timer-countdown',
  glass: 'timer-glass',
  docked: 'timer-docked',
  press: 'timer-body',
};

function renderSheet(
  overrides?: Partial<React.ComponentProps<typeof WorkoutTimerSheet>>
) {
  const props = {
    phase: 'rest' as const,
    remainingMs: 74_000,
    progress: 0.62,
    paused: false,
    hint: 'Then set 2 · 135 lbs × 8',
    onAdjust: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onDismiss: jest.fn(),
    onPressBody: jest.fn(),
    testIDs: TEST_IDS,
    ...overrides,
  };
  const utils = render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <WorkoutTimerSheet {...props} />
    </SafeAreaProvider>
  );
  return { ...utils, props };
}

describe('WorkoutTimerSheet', () => {
  beforeEach(() => {
    mockUseNativeIOSTabsActive.mockReturnValue(false);
  });

  it('names its phase in the eyebrow, with the matching dismissal beside it', () => {
    const rest = renderSheet({ phase: 'rest' });
    expect(rest.getByText('Rest')).toBeTruthy();
    expect(rest.getByText('Skip')).toBeTruthy();
    fireEvent.press(rest.getByLabelText('Skip rest'));
    expect(rest.props.onDismiss).toHaveBeenCalledTimes(1);
    rest.unmount();

    const hold = renderSheet({ phase: 'hold' });
    expect(hold.getByText('Hold')).toBeTruthy();
    expect(hold.getByText('Stop')).toBeTruthy();
    fireEvent.press(hold.getByLabelText('Stop hold and log the set'));
    expect(hold.props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('names the phase in its ±15s and pause labels too, so a screen reader hears which timer it is holding', () => {
    const hold = renderSheet({ phase: 'hold' });
    expect(hold.getByLabelText('Shorten hold by 15 seconds')).toBeTruthy();
    expect(hold.getByLabelText('Extend hold by 15 seconds')).toBeTruthy();
    expect(hold.getByLabelText('Pause hold')).toBeTruthy();
    hold.unmount();

    const rest = renderSheet({ phase: 'rest', paused: true });
    expect(rest.getByLabelText('Shorten rest by 15 seconds')).toBeTruthy();
    expect(rest.getByLabelText('Resume rest')).toBeTruthy();
  });

  it('runs the progress track edge to edge while docked', () => {
    // The canvas draws the track full-bleed under the sheet's top border, which
    // a sheet with 16pt side padding only gets by pulling it back out again.
    const { getByTestId } = renderSheet();
    const style = StyleSheet.flatten(getByTestId(TEST_IDS.track).props.style);
    expect(style.marginHorizontal).toBe(-16);
    expect(style.height).toBe(3);
    expect(
      StyleSheet.flatten(getByTestId(TEST_IDS.fill).props.style).width
    ).toBe('62%');
  });

  it('insets and rounds the track inside the glass pill instead', () => {
    // A full-bleed bar inside a 28pt-radius floating pill would run out past
    // its corners; the pill is not an edge of the screen to bleed to.
    mockUseNativeIOSTabsActive.mockReturnValue(true);
    const { getByTestId, queryByTestId } = renderSheet();
    const style = StyleSheet.flatten(getByTestId(TEST_IDS.track).props.style);
    expect(style.marginHorizontal).toBeUndefined();
    expect(style.borderRadius).toBe(999);
    expect(getByTestId(TEST_IDS.glass)).toBeTruthy();
    expect(queryByTestId(TEST_IDS.docked)).toBeNull();
  });

  it('renders the footer only when the caller supplies one', () => {
    const without = renderSheet({ footer: null });
    expect(without.queryByText('Log set 2 now')).toBeNull();
    without.unmount();

    const onPress = jest.fn();
    const { getByLabelText, getByText } = renderSheet({
      footer: {
        label: 'Log set 2 now',
        accessibilityLabel: 'Log set',
        onPress,
      },
    });
    expect(getByText('Log set 2 now')).toBeTruthy();
    fireEvent.press(getByLabelText('Log set'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides the hint line when there is nothing to say about zero', () => {
    const { queryByText } = renderSheet({ hint: null });
    expect(queryByText('Then set 2 · 135 lbs × 8')).toBeNull();
    expect(queryByText('1:14')).toBeTruthy();
  });

  it('fires onPressBody only for taps outside the controls', () => {
    const { getByTestId, getByLabelText, props } = renderSheet();
    fireEvent.press(getByTestId(TEST_IDS.press));
    expect(props.onPressBody).toHaveBeenCalledTimes(1);
    fireEvent.press(getByLabelText('Pause rest'));
    fireEvent.press(getByLabelText('Skip rest'));
    expect(props.onPressBody).toHaveBeenCalledTimes(1);
  });

  it('renders the countdown from the remaining milliseconds', () => {
    const { getByTestId } = renderSheet({ remainingMs: 74_000 });
    expect(getByTestId(TEST_IDS.countdown).props.children).toBe('1:14');
  });
});
