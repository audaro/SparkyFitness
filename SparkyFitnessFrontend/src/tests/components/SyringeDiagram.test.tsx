import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import SyringeDiagram from '@/pages/Medications/SyringeDiagram';

// Same interpolating `t` as the calculator suite: an unmatched `{{placeholder}}` surviving into
// the accessible label is exactly what a screen-reader user would hear.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValue: string,
      params?: Record<string, string | number>
    ) =>
      defaultValue.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
        params && Object.hasOwn(params, name) ? String(params[name]) : whole
      ),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

/**
 * The picture is the one part of the answer a user reads without reading a number, so what is
 * asserted here is the fill geometry rather than the markup: how wide the filled rectangle is
 * against the barrel behind it.
 */
function roundedRects(): Element[] {
  return Array.from(document.querySelectorAll('svg rect')).filter(
    (rect) => rect.getAttribute('rx') === '3'
  );
}

function fillFraction(axis: 'width' | 'height' = 'width'): number {
  // The barrel is the first rounded rect (it is the one every other measurement is against);
  // the fill is the rect drawn immediately after it, from the same corner.
  const [barrel, fill] = roundedRects();
  if (!barrel) throw new Error('no barrel drawn');
  const span = Number(barrel.getAttribute(axis));
  return fill === undefined ? 0 : Number(fill.getAttribute(axis)) / span;
}

/**
 * Where the 0 graduation sits, and where the needle does, along the axis the barrel runs on.
 * They belong at the same end: 0 is where the stopper rests on an empty syringe, which is
 * against the needle, and the fill grows away from it. Drawn the other way round the picture is
 * a syringe held backwards — the mark still lands on the right number, which is why nothing
 * else here would catch it.
 */
function endsAlong(axis: 'x' | 'y'): {
  zeroTick: number;
  lastTick: number;
  needle: number;
  barrelNear: number;
  barrelFar: number;
} {
  // Graduations are the only `<line>`s except the mark, which is drawn last.
  const lines = Array.from(document.querySelectorAll('svg line')).slice(0, -1);
  const zero = lines[0];
  const last = lines[lines.length - 1];
  if (!zero || !last) throw new Error('no graduations drawn');
  // The needle shaft is the only rect in the darker decoration tone.
  const needle = Array.from(document.querySelectorAll('svg rect')).find(
    (rect) => rect.getAttribute('class')?.includes('fill-muted-foreground/60')
  );
  const barrel = roundedRects()[0];
  if (!needle || !barrel) throw new Error('no needle or barrel drawn');
  const start = axis === 'x' ? 'x1' : 'y1';
  const near = Number(barrel.getAttribute(axis));
  return {
    zeroTick: Number(zero.getAttribute(start)),
    lastTick: Number(last.getAttribute(start)),
    needle: Number(needle.getAttribute(axis)),
    barrelNear: near,
    barrelFar:
      near + Number(barrel.getAttribute(axis === 'x' ? 'width' : 'height')),
  };
}

describe('SyringeDiagram', () => {
  it('fills the barrel to the fraction the draw occupies', () => {
    render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    expect(fillFraction()).toBeCloseTo(0.3, 5);
  });

  it('draws the same units fuller on a smaller barrel', () => {
    // The whole reason capacity is passed in rather than assumed: 30 units is a third of one
    // barrel and three quarters of the other, and a picture that got this wrong would be worse
    // than no picture.
    render(<SyringeDiagram units={30} syringe="U-40" capacityUnits={40} />);

    expect(fillFraction()).toBeCloseTo(0.75, 5);
  });

  it('numbers the barrel so the user can find the mark to stop at', () => {
    render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    const labels = Array.from(document.querySelectorAll('svg text')).map(
      (node) => node.textContent
    );
    expect(labels).toEqual([
      '0',
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
      '70',
      '80',
      '90',
      '100',
    ]);
  });

  it('names the barrel and the draw for a screen reader', () => {
    render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    // Not decorative: someone who cannot see the picture still needs the fact it carries.
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'A U-100 syringe barrel holding 100 units, filled to 30.'
    );
  });

  it('stops the fill at the end of the barrel when the draw does not fit', () => {
    render(<SyringeDiagram units={140} syringe="U-100" capacityUnits={100} />);

    expect(fillFraction()).toBe(1);
    // A full barrel in the ordinary colour would read as "draw to the top"; the amber matches
    // the over-capacity warning sitting under it.
    expect(roundedRects()[1]).toHaveClass('fill-amber-500/40');
    // The label still reports the number the syringe cannot hold, not the clamped one.
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'A U-100 syringe barrel holding 100 units, filled to 140.'
    );
  });

  it('draws nothing rather than a barrel at a scale nobody can name', () => {
    const { container } = render(
      <SyringeDiagram units={30} syringe="U-100" capacityUnits={0} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('draws a below-precision dose as the sliver it is', () => {
    // No special case: 1 unit *looking* like almost nothing is the same thing the
    // below-precision warning says in words.
    render(<SyringeDiagram units={1} syringe="U-100" capacityUnits={100} />);

    expect(fillFraction()).toBeCloseTo(0.01, 5);
  });

  it('puts the 0 graduation at the needle, so the fill grows away from it', () => {
    render(<SyringeDiagram units={30} syringe="U-100" capacityUnits={100} />);

    const { zeroTick, lastTick, needle, barrelNear, barrelFar } =
      endsAlong('x');
    // The needle is left of the barrel; the 0 mark is on that same left edge and the capacity
    // mark on the far one, so the numbers count up toward the plunger.
    expect(needle).toBeLessThan(barrelNear);
    expect(zeroTick).toBe(barrelNear);
    expect(lastTick).toBe(barrelFar);
    // ...and the fill starts from that same edge.
    const [barrel, fill] = roundedRects();
    expect(fill?.getAttribute('x')).toBe(barrel?.getAttribute('x'));
  });

  describe('vertical', () => {
    it('fills the barrel downward to the fraction the draw occupies', () => {
      render(
        <SyringeDiagram
          units={30}
          syringe="U-100"
          capacityUnits={100}
          orientation="vertical"
        />
      );

      expect(fillFraction('height')).toBeCloseTo(0.3, 5);
      // Same corner as the barrel, so the liquid hangs from the needle end rather than
      // floating in the middle of the tube.
      const [barrel, fill] = roundedRects();
      expect(fill?.getAttribute('y')).toBe(barrel?.getAttribute('y'));
    });

    it('hangs needle-up, with the 0 graduation at the top', () => {
      render(
        <SyringeDiagram
          units={30}
          syringe="U-100"
          capacityUnits={100}
          orientation="vertical"
        />
      );

      const { zeroTick, lastTick, needle, barrelNear, barrelFar } =
        endsAlong('y');
      expect(needle).toBeLessThan(barrelNear);
      expect(zeroTick).toBe(barrelNear);
      expect(lastTick).toBe(barrelFar);
    });

    it('numbers the barrel exactly as the horizontal one does', () => {
      // The two orientations are one drawing turned on its side. A user who reads the dose on
      // the phone and mixes it at the desk must not meet a differently-marked barrel.
      render(
        <SyringeDiagram
          units={30}
          syringe="U-40"
          capacityUnits={40}
          orientation="vertical"
        />
      );

      const labels = Array.from(document.querySelectorAll('svg text')).map(
        (node) => node.textContent
      );
      expect(labels).toEqual([
        '0',
        '5',
        '10',
        '15',
        '20',
        '25',
        '30',
        '35',
        '40',
      ]);
    });

    it('still names the barrel and the draw for a screen reader', () => {
      render(
        <SyringeDiagram
          units={140}
          syringe="U-100"
          capacityUnits={100}
          orientation="vertical"
        />
      );

      expect(fillFraction('height')).toBe(1);
      expect(roundedRects()[1]).toHaveClass('fill-amber-500/40');
      expect(screen.getByRole('img')).toHaveAccessibleName(
        'A U-100 syringe barrel holding 100 units, filled to 140.'
      );
    });
  });
});
