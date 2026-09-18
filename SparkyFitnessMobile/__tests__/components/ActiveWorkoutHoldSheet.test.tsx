import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import ActiveWorkoutHoldSheet from '../../src/components/ActiveWorkoutHoldSheet';
import { useNativeIOSTabsActive } from '../../src/services/nativeTabBarPreference';

jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSTabsActive: jest.fn(() => false),
}));

const mockUseNativeIOSTabsActive =
  useNativeIOSTabsActive as jest.MockedFunction<typeof useNativeIOSTabsActive>;

// Distinct values per variable so the paused-vs-holding color assertions mean
// something (the global uniwind mock returns one color for everything).
const COLORS: Record<string, string> = {
  '--color-accent-primary': '#427cf0',
  '--color-text-muted': '#737b8c',
  '--color-progress-track': '#233453',
  '--color-text-primary': '#e8eaee',
};

const ACCENT = COLORS['--color-accent-primary'];
const MUTED = COLORS['--color-text-muted'];
const INK = COLORS['--color-text-primary'];

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

function renderSheet(
  overrides?: Partial<React.ComponentProps<typeof ActiveWorkoutHoldSheet>>
) {
  const props = {
    remainingMs: 32_000,
    progress: 0.71,
    paused: false,
    label: 'Plank · Set 1',
    nextRestSec: 30,
    onAdjust: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onStop: jest.fn(),
    ...overrides,
  };
  const utils = render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <ActiveWorkoutHoldSheet {...props} />
    </SafeAreaProvider>
  );
  return { ...utils, props };
}

function fillStyle(getByTestId: (id: string) => any) {
  return StyleSheet.flatten(getByTestId('hold-progress-fill').props.style);
}

describe('ActiveWorkoutHoldSheet', () => {
  beforeEach(() => {
    mockUseNativeIOSTabsActive.mockReturnValue(false);
    (useCSSVariable as jest.Mock).mockImplementation(
      (vars: string | string[]) =>
        Array.isArray(vars)
          ? vars.map((v) => COLORS[v] ?? '#888888')
          : (COLORS[vars] ?? '#888888')
    );
  });

  it('renders the countdown under a HOLD eyebrow, naming what is being held', () => {
    const { getByText } = renderSheet();
    expect(getByText('0:32')).toBeTruthy();
    expect(getByText('Hold')).toBeTruthy();
    expect(
      getByText('Plank · Set 1 · Logs at 0:00, then 30s rest')
    ).toBeTruthy();
  });

  it('names the rest that follows so the handoff is not a surprise', () => {
    const { getByText } = renderSheet({ nextRestSec: 30 });
    expect(
      getByText('Plank · Set 1 · Logs at 0:00, then 30s rest')
    ).toBeTruthy();
  });

  it('says only that it logs when no rest follows', () => {
    const { getByText } = renderSheet({ nextRestSec: 0 });
    expect(getByText('Plank · Set 1 · Logs at 0:00')).toBeTruthy();
  });

  it('drops the label from the hint when there is none to show', () => {
    const { getByText } = renderSheet({ label: '', nextRestSec: 30 });
    expect(getByText('Logs at 0:00, then 30s rest')).toBeTruthy();
  });

  it('offers no footer action, since Stop is the hold-s only early ending', () => {
    const { queryByLabelText } = renderSheet();
    expect(queryByLabelText('Complete set')).toBeNull();
  });

  it('sets the progress fill width from the progress fraction', () => {
    const { getByTestId } = renderSheet({ progress: 0.5 });
    expect(fillStyle(getByTestId).width).toBe('50%');
  });

  it('carries the phase color on the chrome and plain ink on the countdown', () => {
    // The number is what gets read at a glance, so it stays text-primary and
    // the accent goes on the track and the pause target around it. Pausing
    // mutes both — that is the one state the countdown itself has to signal.
    const holding = renderSheet({ paused: false });
    expect(fillStyle(holding.getByTestId).backgroundColor).toBe(ACCENT);
    expect(
      StyleSheet.flatten(holding.getByText('0:32').props.style).color
    ).toBe(INK);
    holding.unmount();

    const paused = renderSheet({ paused: true });
    expect(fillStyle(paused.getByTestId).backgroundColor).toBe(MUTED);
    expect(StyleSheet.flatten(paused.getByText('0:32').props.style).color).toBe(
      MUTED
    );
  });

  it('adjusts by the app-wide 15s step in both directions', () => {
    const { getByLabelText, props } = renderSheet();
    fireEvent.press(getByLabelText('Extend hold by 15 seconds'));
    expect(props.onAdjust).toHaveBeenCalledWith(15);
    fireEvent.press(getByLabelText('Shorten hold by 15 seconds'));
    expect(props.onAdjust).toHaveBeenCalledWith(-15);
  });

  it('offers pause while holding and resume while paused', () => {
    const holding = renderSheet({ paused: false });
    fireEvent.press(holding.getByLabelText('Pause hold'));
    expect(holding.props.onPause).toHaveBeenCalledTimes(1);
    expect(holding.queryByLabelText('Resume hold')).toBeNull();
    holding.unmount();

    const paused = renderSheet({ paused: true });
    fireEvent.press(paused.getByLabelText('Resume hold'));
    expect(paused.props.onResume).toHaveBeenCalledTimes(1);
    expect(paused.queryByLabelText('Pause hold')).toBeNull();
  });

  it('stopping says it logs the set, since that is not undoable from here', () => {
    const { getByLabelText, props } = renderSheet();
    fireEvent.press(getByLabelText('Stop hold and log the set'));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('docks below the log without Liquid Glass tabs', () => {
    const { getByTestId } = renderSheet();
    expect(getByTestId('hold-sheet-docked')).toBeTruthy();
  });

  it('floats as a glass pill when Liquid Glass tabs are active', () => {
    mockUseNativeIOSTabsActive.mockReturnValue(true);
    const { getByTestId, queryByTestId } = renderSheet();
    expect(getByTestId('hold-sheet-glass')).toBeTruthy();
    expect(queryByTestId('hold-sheet-docked')).toBeNull();
  });
});
