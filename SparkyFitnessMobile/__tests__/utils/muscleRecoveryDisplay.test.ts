import {
  freshnessPercent,
  freshnessTone,
} from '../../src/utils/muscleRecoveryDisplay';

describe('freshnessPercent', () => {
  it('scales the 0.0-1.0 score to a whole percentage', () => {
    expect(freshnessPercent(1)).toBe(100);
    expect(freshnessPercent(0.844)).toBe(84);
    expect(freshnessPercent(0.125)).toBe(13);
    expect(freshnessPercent(0)).toBe(0);
  });

  // The value drives a bar width, so an out-of-contract score must not draw
  // past the end of its track.
  it('clamps anything outside the contract', () => {
    expect(freshnessPercent(1.4)).toBe(100);
    expect(freshnessPercent(-0.2)).toBe(0);
    expect(freshnessPercent(Number.NaN)).toBe(0);
  });
});

describe('freshnessTone', () => {
  it('bands on the raw score, inclusive at each threshold', () => {
    expect(freshnessTone(1)).toBe('fresh');
    expect(freshnessTone(0.66)).toBe('fresh');
    expect(freshnessTone(0.659)).toBe('moderate');
    expect(freshnessTone(0.33)).toBe('moderate');
    expect(freshnessTone(0.329)).toBe('fatigued');
    expect(freshnessTone(0)).toBe('fatigued');
  });
});
