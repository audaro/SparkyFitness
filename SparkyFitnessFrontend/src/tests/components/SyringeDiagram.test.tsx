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
function fillFraction(): number {
  const rects = document.querySelectorAll('svg rect');
  // The barrel is the widest rect (it is the one every other measurement is against); the fill
  // is the rect drawn immediately after it, at the same x.
  const barrel = Array.from(rects).find(
    (rect) => rect.getAttribute('rx') === '3'
  );
  const fill = Array.from(rects).filter(
    (rect) => rect.getAttribute('rx') === '3'
  )[1];
  if (!barrel) throw new Error('no barrel drawn');
  const width = Number(barrel.getAttribute('width'));
  return fill === undefined ? 0 : Number(fill.getAttribute('width')) / width;
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
    const fill = Array.from(document.querySelectorAll('svg rect')).filter(
      (rect) => rect.getAttribute('rx') === '3'
    )[1];
    expect(fill).toHaveClass('fill-amber-500/40');
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
});
