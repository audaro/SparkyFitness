import { render } from '@testing-library/react-native';
import { MUSCLES } from '@workspace/shared';

import MuscleRegionBadge from '../../src/components/MuscleRegionBadge';

// The global mock resolves every variable to one grey, which would make the
// lit region indistinguishable from the rest of the figure. Real, distinct
// hexes — react-native-svg drops a fill it cannot parse as a colour, which
// would collapse them all again — so "which part is lit" is observable.
const TEST_COLORS: Record<string, string> = {
  '--color-raised': '#111111',
  '--color-border': '#222222',
  '--color-text-muted': '#333333',
  '--color-text-primary': '#eeeeee',
};
jest.mock('uniwind', () => ({
  useCSSVariable: jest.fn((vars: string[]) =>
    vars.map((name) => TEST_COLORS[name] ?? '#888888')
  ),
  useUniwind: jest.fn(() => ({ theme: 'light', hasAdaptiveThemes: false })),
  Uniwind: { setTheme: jest.fn() },
}));

describe('MuscleRegionBadge', () => {
  it('draws a figure for every canonical muscle', () => {
    for (const muscle of MUSCLES) {
      const { toJSON } = render(<MuscleRegionBadge muscle={muscle} />);
      expect(toJSON()).not.toBeNull();
    }
  });

  it('accepts the catalog spelling, not just the canonical one', () => {
    const { toJSON } = render(<MuscleRegionBadge muscle="Quadriceps" />);

    expect(toJSON()).not.toBeNull();
  });

  it('renders nothing rather than a blank body for an unknown muscle', () => {
    // A figure with no region lit is a puzzle, not a hint — a custom exercise
    // with no muscle recorded should get no badge at all.
    expect(render(<MuscleRegionBadge muscle={null} />).toJSON()).toBeNull();
    expect(
      render(<MuscleRegionBadge muscle="left pinky" />).toJSON()
    ).toBeNull();
  });

  it('lights a different region for a leg muscle than for a chest one', () => {
    const legs = JSON.stringify(
      render(<MuscleRegionBadge muscle="calves" />).toJSON()
    );
    const chest = JSON.stringify(
      render(<MuscleRegionBadge muscle="chest" />).toJSON()
    );

    expect(legs).not.toEqual(chest);
  });

  it('lights the same region for two muscles that share one', () => {
    // The figure is a front view: `lats` and `chest` are the same block, and
    // the row names the muscle in words beside it.
    const lats = JSON.stringify(
      render(<MuscleRegionBadge muscle="lats" />).toJSON()
    );
    const chest = JSON.stringify(
      render(<MuscleRegionBadge muscle="chest" />).toJSON()
    );

    expect(lats).toEqual(chest);
  });
});
