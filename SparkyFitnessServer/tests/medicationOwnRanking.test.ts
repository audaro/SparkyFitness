import { describe, it, expect } from 'vitest';
import { rankOwnMedications } from '@workspace/shared';

/**
 * Tier 1 of the medication name search. The cap is three or four rows against a cabinet that can
 * hold dozens, so the whole value of this function is *which* matches survive the slice.
 */

interface Row {
  id: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
  last_taken_at?: string | null;
}

const med = (
  name: string,
  overrides: Partial<Omit<Row, 'name'>> = {}
): Row => ({
  id: `med-${name}`,
  name,
  display_name: null,
  is_active: true,
  last_taken_at: null,
  ...overrides,
});

const names = (rows: Row[]) => rows.map((row) => row.name);

describe('rankOwnMedications', () => {
  it('puts the most recently taken first', () => {
    const cabinet = [
      med('Tirzepatide', { last_taken_at: '2026-08-01T09:00:00.000Z' }),
      med('Testosterone', { last_taken_at: '2026-08-24T09:00:00.000Z' }),
      med('Tesamorelin', { last_taken_at: '2026-08-12T09:00:00.000Z' }),
    ];
    expect(names(rankOwnMedications(cabinet, 't', 3))).toEqual([
      'Testosterone',
      'Tesamorelin',
      'Tirzepatide',
    ]);
  });

  it('offers what the user takes rather than what sorts first', () => {
    // The failure this exists to fix: four matches, three slots, and the one they actually take
    // is last in the alphabet.
    const cabinet = [
      med('Tadalafil'),
      med('Telmisartan'),
      med('Tetracycline'),
      med('Tirzepatide', { last_taken_at: '2026-08-24T09:00:00.000Z' }),
    ];
    expect(names(rankOwnMedications(cabinet, 't', 3))[0]).toBe('Tirzepatide');
  });

  it('ranks a drug never taken below every drug that has been', () => {
    const cabinet = [
      med('Tesamorelin'),
      med('Tirzepatide', { last_taken_at: '2020-01-01T09:00:00.000Z' }),
    ];
    // Years ago still beats never: one of these is a medication, the other is a row someone
    // typed in and abandoned.
    expect(names(rankOwnMedications(cabinet, 't', 5))).toEqual([
      'Tirzepatide',
      'Tesamorelin',
    ]);
  });

  it('sorts the never-taken alphabetically', () => {
    const cabinet = [med('Tirzepatide'), med('Tesamorelin'), med('Tadalafil')];
    expect(names(rankOwnMedications(cabinet, 't', 5))).toEqual([
      'Tadalafil',
      'Tesamorelin',
      'Tirzepatide',
    ]);
  });

  it('keeps a discontinued drug below the active ones however recently it was taken', () => {
    const cabinet = [
      med('Tirzepatide', {
        is_active: false,
        last_taken_at: '2026-08-24T09:00:00.000Z',
      }),
      med('Tesamorelin', { last_taken_at: '2026-01-01T09:00:00.000Z' }),
      med('Tadalafil'),
    ];
    // Stopping a medication is a statement about it; the last dose before stopping is not.
    expect(names(rankOwnMedications(cabinet, 't', 5))).toEqual([
      'Tesamorelin',
      'Tadalafil',
      'Tirzepatide',
    ]);
  });

  it('matches the display name as well as the name', () => {
    const cabinet = [med('Semaglutide', { display_name: 'Ozempic' })];
    expect(names(rankOwnMedications(cabinet, 'ozem', 5))).toEqual([
      'Semaglutide',
    ]);
  });

  it('matches without regard to case or surrounding space', () => {
    const cabinet = [med('Tirzepatide')];
    expect(rankOwnMedications(cabinet, '  TIRZ  ', 5)).toHaveLength(1);
  });

  it('honours the cap', () => {
    const cabinet = [med('Ta'), med('Tb'), med('Tc'), med('Td')];
    expect(rankOwnMedications(cabinet, 't', 2)).toHaveLength(2);
  });

  it('returns nothing for a blank query', () => {
    expect(rankOwnMedications([med('Tirzepatide')], '   ', 5)).toEqual([]);
  });

  it('leaves the caller’s array alone', () => {
    const cabinet = [
      med('Tirzepatide'),
      med('Tesamorelin', { last_taken_at: '2026-08-24T09:00:00.000Z' }),
    ];
    rankOwnMedications(cabinet, 't', 5);
    // The cabinet is React Query's cached list on both clients; sorting it in place would
    // reorder the medications page as a side effect of opening a dropdown.
    expect(names(cabinet)).toEqual(['Tirzepatide', 'Tesamorelin']);
  });

  it('treats a row with no last-taken field at all as never taken', () => {
    // `last_taken_at` is optional: a medication read on its own does not carry it, and a client
    // holding such a row must still get an order rather than an exception.
    const cabinet: Row[] = [
      { id: 'a', name: 'Tesamorelin', display_name: null, is_active: true },
      med('Tirzepatide', { last_taken_at: '2026-08-24T09:00:00.000Z' }),
    ];
    expect(names(rankOwnMedications(cabinet, 't', 5))).toEqual([
      'Tirzepatide',
      'Tesamorelin',
    ]);
  });

  it('treats an unparseable timestamp as never taken rather than as newest', () => {
    const cabinet = [
      med('Tesamorelin', { last_taken_at: 'not a date' }),
      med('Tirzepatide', { last_taken_at: '2020-01-01T09:00:00.000Z' }),
    ];
    // `Date.parse` gives NaN, and NaN compares false against everything — left unguarded it
    // would sort arbitrarily depending on the input order.
    expect(names(rankOwnMedications(cabinet, 't', 5))).toEqual([
      'Tirzepatide',
      'Tesamorelin',
    ]);
  });
});
