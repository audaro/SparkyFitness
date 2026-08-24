import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import MuscleTile from '../../src/components/MuscleTile';

function renderTile(props: Partial<React.ComponentProps<typeof MuscleTile>> = {}) {
  return render(
    <MuscleTile
      label="Chest"
      percent={84}
      tone="fresh"
      selected={false}
      onPress={jest.fn()}
      testID="tile-chest"
      {...props}
    />,
  );
}

describe('MuscleTile', () => {
  // D5: the grid ships before the anatomical art does. With no path the tile
  // is still a complete, pickable control.
  it('renders a labelled colour tile when it is given no SVG path', () => {
    const screen = renderTile();

    expect(screen.getByText('Chest')).toBeTruthy();
    expect(screen.getByText('84%')).toBeTruthy();
    expect(screen.getByTestId('tile-chest-art')).toBeTruthy();
  });

  it('draws the muscle path when one is supplied', () => {
    const screen = renderTile({ svgPath: 'M0 0 L10 10 Z' });

    expect(screen.UNSAFE_getAllByProps({ d: 'M0 0 L10 10 Z' }).length).toBeGreaterThan(0);
  });

  // The percentage is already 0-100 from the hook's select; a tile that
  // multiplied again would show 1% everywhere.
  it('renders the percentage it is handed, unconverted', () => {
    const screen = renderTile({ percent: 100 });

    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('stays pickable when recovery is unknown', () => {
    const onPress = jest.fn();
    const screen = renderTile({ percent: null, tone: null, onPress });

    expect(screen.getByText('—')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tile-chest'));
    expect(onPress).toHaveBeenCalled();
  });

  it('exposes selection to assistive technology', () => {
    const screen = renderTile({ selected: true });

    expect(screen.getByTestId('tile-chest').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByLabelText('Chest, 84% recovered')).toBeTruthy();
  });
});
