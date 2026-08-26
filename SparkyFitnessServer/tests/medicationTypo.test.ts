import { describe, expect, it } from 'vitest';
import {
  bestTypoMatch,
  boundedEditDistance,
  typoDistance,
} from '@workspace/shared';

/**
 * The primitive behind typo tolerance in the medication name search.
 *
 * What is being pinned down here is not "does it find similar strings" — it is where the
 * tolerance *stops*. Every one of these names is something a user might record as a drug they
 * take, so a bound that is one edit too generous is a wrong drug offered under a confident row,
 * which the search's own comments call worse than an empty list.
 */

describe('boundedEditDistance', () => {
  it('is zero for an identical string', () => {
    expect(boundedEditDistance('metformin', 'metformin', 2)).toBe(0);
  });

  it('counts a substitution, an insertion and a deletion as one edit each', () => {
    expect(boundedEditDistance('metformin', 'netformin', 2)).toBe(1);
    expect(boundedEditDistance('metformin', 'metforminn', 2)).toBe(1);
    expect(boundedEditDistance('metformin', 'metformi', 2)).toBe(1);
  });

  it('counts an adjacent transposition as one edit, not two', () => {
    // The whole reason the distance is Damerau-Levenshtein. Plain Levenshtein charges these two,
    // which pushes the commonest typo in a typed drug name past a threshold tight enough to be
    // safe in the first place.
    expect(boundedEditDistance('metformin', 'metfromin', 2)).toBe(1);
    expect(boundedEditDistance('testosterone', 'testosteorne', 2)).toBe(1);
  });

  it('returns null rather than the true distance once the bound is passed', () => {
    expect(boundedEditDistance('metformin', 'merbromin', 1)).toBeNull();
    expect(boundedEditDistance('metformin', 'merbromin', 4)).toBe(3);
  });

  it('rules a pair out on length before measuring anything', () => {
    expect(boundedEditDistance('a', 'abcdefghij', 2)).toBeNull();
  });

  it('handles an empty string on either side', () => {
    expect(boundedEditDistance('', 'ab', 2)).toBe(2);
    expect(boundedEditDistance('ab', '', 2)).toBe(2);
    expect(boundedEditDistance('', 'abc', 2)).toBeNull();
    expect(boundedEditDistance('', '', 2)).toBe(0);
  });

  it('never reports a distance for a negative budget', () => {
    expect(boundedEditDistance('a', 'b', -1)).toBeNull();
  });
});

describe('typoDistance', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(typoDistance('Metformin', '  metfromin ')).toBe(1);
  });

  it('allows one edit on a short name and two on a long one', () => {
    // 'Ozempic' is 7 characters: one edit. At two, a seven-letter brand is within reach of
    // things that are not it.
    expect(typoDistance('Ozempic', 'ozempicc')).toBe(1);
    expect(typoDistance('Ozempic', 'ozempccc')).toBeNull();
    // 'Tesamorelin' is 11: two edits, and it is still unmistakably itself.
    expect(typoDistance('Tesamorelin', 'tesamorelnii')).toBe(2);
  });

  it('refuses anything below the fuzzy floor, on either side', () => {
    expect(typoDistance('HCG', 'hcx')).toBeNull();
    expect(typoDistance('Semaglutide', 'sem')).toBeNull();
  });

  it('does not treat a prefix as a misspelling', () => {
    // Someone four characters into a twelve-character name is typing. The substring pass is
    // already showing them what they want, and this must not add a second opinion.
    expect(typoDistance('Retatrutide', 'reta')).toBeNull();
  });
});

describe('bestTypoMatch', () => {
  it('returns the closest candidate and how far away it is', () => {
    const match = bestTypoMatch(['Semaglutide', 'Tirzepatide'], 'semaglutde');
    expect(match).toEqual({ candidate: 'Semaglutide', distance: 1 });
  });

  it('breaks a tie on the earlier candidate, so a name beats its own alias', () => {
    const match = bestTypoMatch(['Ipamorelin', 'Ipamorelyn'], 'ipamorelim');
    expect(match?.candidate).toBe('Ipamorelin');
  });

  it('is null when nothing is close enough', () => {
    expect(bestTypoMatch(['Semaglutide'], 'grocery list')).toBeNull();
    expect(bestTypoMatch([], 'semaglutide')).toBeNull();
  });
});
