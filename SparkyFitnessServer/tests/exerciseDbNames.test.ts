import { describe, expect, it } from 'vitest';
import { cleanExerciseDbExerciseName } from '../integrations/exercisedb/exerciseDbNames.js';

// The examples are real names from the pinned 2026-08-27 catalog, one per
// naming convention the cleanup handles.
describe('cleanExerciseDbExerciseName', () => {
  const cases: [string, string][] = [
    // "lever" is the catalog's word for a leverage machine.
    ['lever lateral raise', 'Machine Lateral Raise'],
    [
      'lever one arm lateral wide pulldown',
      'Machine One Arm Lateral Wide Pulldown',
    ],
    // …but never say machine twice.
    [
      'lever seated squat calf raise on leg press machine',
      'Seated Squat Calf Raise on Leg Press Machine',
    ],
    ['machine inner chest press', 'Machine Inner Chest Press'],
    // Both smith spellings normalize to the full station name.
    ['smith squat', 'Smith Machine Squat'],
    ['smith machine bicep curl', 'Smith Machine Bicep Curl'],
    // "sled" tags the 45° leg press / hack squat family.
    ['sled hack squat', 'Hack Squat'],
    // Mojibake, the spelled-out degree, and camera-angle suffixes.
    ['sled 45в° leg press (back pov)', '45° Leg Press'],
    ['sled 45 degrees one leg press', '45° One Leg Press'],
    // Version suffixes become readable variation markers and stay distinct.
    ['lever shoulder press v. 2', 'Machine Shoulder Press (Variation 2)'],
    ['lever shoulder press v. 3', 'Machine Shoulder Press (Variation 3)'],
    // Casing details: hyphen parts, parentheses, small words.
    ['lever bent-over row with v-bar', 'Machine Bent-Over Row with V-Bar'],
    ['lever t bar row', 'Machine T-Bar Row'],
    ['assisted chest dip (kneeling)', 'Assisted Chest Dip (Kneeling)'],
    [
      'smith front squat (clean grip)',
      'Smith Machine Front Squat (Clean Grip)',
    ],
  ];

  it.each(cases)('cleans %j', (raw, expected) => {
    expect(cleanExerciseDbExerciseName(raw)).toBe(expected);
  });

  it('is idempotent, because membership and the mapper both apply it', () => {
    for (const [raw, expected] of cases) {
      expect(cleanExerciseDbExerciseName(expected)).toBe(expected);
      expect(
        cleanExerciseDbExerciseName(cleanExerciseDbExerciseName(raw))
      ).toBe(expected);
    }
  });

  it('collapses pov re-films onto their base movement', () => {
    const base = cleanExerciseDbExerciseName('sled 45в° leg press');
    expect(cleanExerciseDbExerciseName('sled 45° leg press (side pov)')).toBe(
      base
    );
    expect(cleanExerciseDbExerciseName('sled 45в° leg press (back pov)')).toBe(
      base
    );
  });

  it('leaves a name with no recognized convention as plain title case', () => {
    expect(cleanExerciseDbExerciseName('hack one leg calf raise')).toBe(
      'Hack One Leg Calf Raise'
    );
  });
});
