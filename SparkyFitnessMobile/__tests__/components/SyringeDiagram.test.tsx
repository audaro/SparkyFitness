import { render } from '@testing-library/react-native';
import { Line, Rect, Text as SvgText } from 'react-native-svg';

import SyringeDiagram from '../../src/components/SyringeDiagram';

// The picture is the one part of the answer a user reads without reading a number, so what is
// asserted here is the fill geometry: how wide the filled rectangle is against the barrel behind
// it. Colours are not asserted — `jest.setup.js` answers every CSS variable with one grey, so a
// tone assertion here would pass whatever the component picked. The web suite covers that half.
function fillFraction(screen: ReturnType<typeof render>): number {
  // The barrel and the fill are the two rounded rects, in that order; everything else on the
  // drawing (plunger, flange, needle) is square.
  const rounded = screen.UNSAFE_getAllByType(Rect).filter((node) => node.props.rx === 3);
  const barrel = rounded[0];
  if (!barrel) throw new Error('no barrel drawn');
  const fill = rounded[1];
  return fill === undefined ? 0 : Number(fill.props.width) / Number(barrel.props.width);
}

describe('SyringeDiagram', () => {
  it('fills the barrel to the fraction the draw occupies', () => {
    const screen = render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    expect(fillFraction(screen)).toBeCloseTo(0.3, 5);
  });

  it('draws the same units fuller on a smaller barrel', () => {
    // The whole reason capacity is passed in rather than assumed: 30 units is a third of one
    // barrel and three quarters of the other, and a picture that got this wrong would be worse
    // than no picture.
    const screen = render(<SyringeDiagram units={30} syringe="U-40" capacityUnits={40} />);

    expect(fillFraction(screen)).toBeCloseTo(0.75, 5);
  });

  it('numbers the barrel so the user can find the mark to stop at', () => {
    const screen = render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    // Queried by type, not by text: an SVG `Text` renders as `RNSVGText`, whose string child is
    // not a text node RNTL's `getByText` can reach.
    const labels = screen.UNSAFE_getAllByType(SvgText).map((node) => node.props.children);

    // A U-100 barrel is numbered every 10, not every mark: 100 numbers would be unreadable at
    // any size that fits in a form.
    expect(labels).toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']);
  });

  it('names the barrel and the draw for a screen reader', () => {
    const screen = render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    // Not decorative: someone who cannot see the picture still needs the fact it carries.
    expect(screen.getByTestId('recon-syringe').props.accessibilityLabel).toBe(
      'A U-100 syringe barrel holding 100 units, filled to 30.',
    );
  });

  it('stops the fill at the end of the barrel when the draw does not fit', () => {
    const screen = render(<SyringeDiagram units={140} syringe="U-100" capacityUnits={100} />);

    expect(fillFraction(screen)).toBe(1);
    // The label still reports the number the syringe cannot hold, not the clamped one — the
    // barrel being full is a floor, not the answer.
    expect(screen.getByTestId('recon-syringe').props.accessibilityLabel).toBe(
      'A U-100 syringe barrel holding 100 units, filled to 140.',
    );
  });

  it('draws nothing rather than a barrel at a scale nobody can name', () => {
    const screen = render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={0} />);

    expect(screen.queryByTestId('recon-syringe')).toBeNull();
  });

  it('draws a below-precision dose as the sliver it is', () => {
    // No special case: 1 unit *looking* like almost nothing is the same thing the
    // below-precision warning says in words.
    const screen = render(<SyringeDiagram units={1} syringe="U-100" capacityUnits={100} />);

    expect(fillFraction(screen)).toBeCloseTo(0.01, 5);
  });

  it('puts the 0 graduation at the needle, so the fill grows away from it', () => {
    // The mark lands on the right number either way round, so nothing else in this file would
    // catch a barrel drawn backwards — and a backwards barrel is a syringe nobody has held.
    const screen = render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    const barrel = screen.UNSAFE_getAllByType(Rect).find((node) => node.props.rx === 3);
    if (!barrel) throw new Error('no barrel drawn');
    const near = Number(barrel.props.x);
    const far = near + Number(barrel.props.width);

    // Graduations are every Line except the mark, which is drawn last.
    const ticks = screen.UNSAFE_getAllByType(Line).slice(0, -1);
    expect(Number(ticks[0]?.props.x1)).toBe(near);
    expect(Number(ticks[ticks.length - 1]?.props.x1)).toBe(far);

    // The needle shaft is the one rect drawn in the darker decoration tone; it sits outside the
    // barrel on the 0 side.
    const needle = screen
      .UNSAFE_getAllByType(Rect)
      .find((node) => node.props.opacity === 0.6);
    expect(Number(needle?.props.x)).toBeLessThan(near);

    // ...and the fill hangs off that same edge.
    const fill = screen.UNSAFE_getAllByType(Rect).filter((node) => node.props.rx === 3)[1];
    expect(Number(fill?.props.x)).toBe(near);
  });
});
