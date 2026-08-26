import { describe, expect, it } from 'vitest';
import { reconstitute, syringeBarrel } from '@workspace/shared';

// The barrel picture is drawn from these numbers on both platforms, so a mistake here is a
// mislabelled syringe in two apps at once. `shared/` has no runner of its own; this suite is
// where its arithmetic gets checked, next to `reconstitutionRecord.test.ts`.
describe('syringeBarrel', () => {
  it('scales the fill to the barrel, not to the volume', () => {
    const barrel = syringeBarrel(30, 'U-100');

    // 30 marks on a 100-mark barrel is not "30% of a mL" by accident — it is 30% because the
    // barrel holds 100, and a U-40 barrel would put the same 30 marks three quarters of the way
    // up. The next assertion is the one that proves it.
    expect(barrel?.fill).toBeCloseTo(0.3, 10);
    expect(barrel?.capacityUnits).toBe(100);
    expect(barrel?.overCapacity).toBe(false);
  });

  it('draws the same number of units differently on a smaller barrel', () => {
    expect(syringeBarrel(30, 'U-40')?.fill).toBeCloseTo(0.75, 10);
  });

  it('numbers a U-100 barrel every 10 marks and a U-40 every 5', () => {
    const hundred = syringeBarrel(0, 'U-100');
    const forty = syringeBarrel(0, 'U-40');

    expect(
      hundred?.ticks.filter((tick) => tick.labelled).map((tick) => tick.units)
    ).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(
      forty?.ticks.filter((tick) => tick.labelled).map((tick) => tick.units)
    ).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it('puts the last mark exactly on the end of the barrel', () => {
    // Accumulating a step would leave it at 0.9999999999999999, which draws as a mark just
    // short of the end of a barrel it is supposed to sit on.
    for (const syringe of ['U-100', 'U-40'] as const) {
      const ticks = syringeBarrel(0, syringe)?.ticks ?? [];
      expect(ticks.at(-1)?.position).toBe(1);
      expect(ticks[0]?.position).toBe(0);
    }
  });

  it('keeps the marks ascending and inside the barrel', () => {
    const ticks = syringeBarrel(0, 'U-100')?.ticks ?? [];

    expect(ticks.length).toBeGreaterThan(1);
    ticks.forEach((tick, index) => {
      expect(tick.position).toBeGreaterThanOrEqual(0);
      expect(tick.position).toBeLessThanOrEqual(1);
      if (index > 0) {
        const previous = ticks[index - 1];
        expect(tick.position).toBeGreaterThan(previous?.position ?? 1);
      }
    });
  });

  it('clamps a draw that does not fit, and says that it clamped', () => {
    const barrel = syringeBarrel(140, 'U-100');

    // A full barrel is a floor, not the answer — so the flag has to come with it, or the
    // picture quietly reads as "draw to 100" for a dose the syringe cannot hold.
    expect(barrel?.fill).toBe(1);
    expect(barrel?.overCapacity).toBe(true);
    // The number the user has to act on is never clamped.
    expect(barrel?.units).toBe(140);
  });

  it('scales to a custom capacity rather than to the standard', () => {
    // A half-mL U-100 barrel: the same 30 marks are more than half of it.
    const barrel = syringeBarrel(30, 'U-100', 50);

    expect(barrel?.capacityUnits).toBe(50);
    expect(barrel?.fill).toBeCloseTo(0.6, 10);
    expect(
      barrel?.ticks.filter((tick) => tick.labelled).map((tick) => tick.units)
    ).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  });

  it('refuses input it cannot draw honestly', () => {
    expect(syringeBarrel(30, 'U-100', 0)).toBeNull();
    expect(syringeBarrel(30, 'U-100', -10)).toBeNull();
    expect(syringeBarrel(30, 'U-100', Number.NaN)).toBeNull();
    expect(syringeBarrel(-1, 'U-100')).toBeNull();
    expect(syringeBarrel(Number.NaN, 'U-100')).toBeNull();
  });

  it('draws a below-precision dose as the sliver it is', () => {
    // No special case: the point of the picture is that 1 unit *looks* like almost nothing,
    // which is the same thing the below-precision warning says in words.
    const barrel = syringeBarrel(1, 'U-100');

    expect(barrel?.fill).toBeCloseTo(0.01, 10);
    expect(barrel?.overCapacity).toBe(false);
  });
});

describe('syringeBarrel against a reconstitute result', () => {
  it('scales to the capacity the answer was measured against', () => {
    const result = reconstitute({
      vial: { amount: 10, unit: 'mg' },
      diluentMl: 1,
      dose: { amount: 2.5, unit: 'mg' },
      syringe: 'U-100',
    });
    if (!result.ok) throw new Error(`expected a result, got ${result.reason}`);

    // The capacity comes off the result, never re-derived from the standard: pass a custom
    // barrel to `reconstitute` and this is the only value that still agrees with its number.
    const barrel = syringeBarrel(
      result.syringeUnits,
      result.syringe,
      result.syringeCapacityUnits
    );

    expect(result.syringeUnits).toBe(25);
    expect(barrel?.fill).toBeCloseTo(0.25, 10);
  });

  it('agrees with the over-capacity warning rather than contradicting it', () => {
    const result = reconstitute({
      vial: { amount: 10, unit: 'mg' },
      diluentMl: 10,
      dose: { amount: 2, unit: 'mg' },
      syringe: 'U-100',
    });
    if (!result.ok) throw new Error(`expected a result, got ${result.reason}`);

    const barrel = syringeBarrel(
      result.syringeUnits,
      result.syringe,
      result.syringeCapacityUnits
    );

    // 2 mL out of a 1 mL barrel. The words and the picture have to say the same thing.
    expect(result.warnings.map((warning) => warning.code)).toContain(
      'exceeds_syringe_capacity'
    );
    expect(barrel?.overCapacity).toBe(true);
  });
});
