import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';
import { toCanonicalMuscle, type Muscle } from '@workspace/shared';

/**
 * The parts the little figure is drawn in. Coarse on purpose: the badge says
 * *where on the body*, and the row's third line already names the muscle
 * exactly, so splitting `lats` from `middle back` would buy nothing legible at
 * 28pt and cost two more shapes.
 */
type Region =
  | 'head'
  | 'shoulders'
  | 'chest'
  | 'abs'
  | 'arms'
  | 'forearms'
  | 'thighs'
  | 'calves';

/**
 * Every canonical muscle, mapped to the part that lights up for it.
 *
 * The figure is a front view and does not distinguish front from back — `lats`
 * and `chest` light the same block. That is not a gap: at this size the two
 * would be the same handful of pixels either way, and the distinction is
 * carried in words beside it.
 *
 * Deliberately exhaustive over `Muscle` rather than a partial record with a
 * fallback, so adding a muscle to the shared vocabulary fails the typecheck
 * here instead of silently drawing a blank body.
 */
const MUSCLE_REGION: Readonly<Record<Muscle, Region>> = {
  neck: 'head',
  traps: 'shoulders',
  shoulders: 'shoulders',
  chest: 'chest',
  lats: 'chest',
  'middle back': 'chest',
  abdominals: 'abs',
  'lower back': 'abs',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'forearms',
  quadriceps: 'thighs',
  hamstrings: 'thighs',
  glutes: 'thighs',
  adductors: 'thighs',
  abductors: 'thighs',
  calves: 'calves',
};

export interface MuscleRegionBadgeProps {
  /** Raw muscle name from the catalog; canonicalized here. */
  muscle: string | null | undefined;
  /** Badge edge length in points. The figure scales with it. */
  size?: number;
}

/**
 * A 28pt body glyph with one region lit, for the corner of an exercise
 * thumbnail.
 *
 * Deliberately NOT `MuscleBodyMap`. That figure is the anatomical illustration
 * from `muscleArt.generated.ts`, whose own docblock records that most regions
 * are 10–20pt across when a figure fills half a phone — a third of a point
 * here. This is eight blobs, which is the most a badge this size can say.
 */
function MuscleRegionBadge({ muscle, size = 28 }: MuscleRegionBadgeProps) {
  const [raised, border, muted, ink] = useCSSVariable([
    '--color-raised',
    '--color-border',
    '--color-text-muted',
    '--color-text-primary',
  ]) as [string, string, string, string];

  const region = useMemo<Region | null>(() => {
    const canonical = muscle == null ? null : toCanonicalMuscle(muscle);
    return canonical == null ? null : MUSCLE_REGION[canonical];
  }, [muscle]);

  // A figure with nothing lit is a puzzle, not a hint — a custom exercise with
  // no muscle recorded gets no badge at all.
  if (region == null) return null;

  const fill = (part: Region) => (part === region ? ink : muted);
  const figure = Math.round(size * 0.58);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        backgroundColor: raised,
        borderWidth: 1,
        borderColor: border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={figure} height={figure} viewBox="0 0 24 24">
        <Circle cx={12} cy={4.4} r={2.1} fill={fill('head')} />
        <Rect x={11} y={6.3} width={2} height={1.3} fill={fill('head')} />
        <Rect
          x={7.2}
          y={7.5}
          width={2.7}
          height={2.3}
          rx={1.15}
          fill={fill('shoulders')}
        />
        <Rect
          x={14.1}
          y={7.5}
          width={2.7}
          height={2.3}
          rx={1.15}
          fill={fill('shoulders')}
        />
        <Rect
          x={9.4}
          y={7.7}
          width={5.2}
          height={3.8}
          rx={1.3}
          fill={fill('chest')}
        />
        <Rect
          x={9.7}
          y={11.7}
          width={4.6}
          height={3.6}
          rx={1.3}
          fill={fill('abs')}
        />
        <Rect
          x={6.9}
          y={8.2}
          width={1.9}
          height={4.3}
          rx={0.95}
          fill={fill('arms')}
        />
        <Rect
          x={15.2}
          y={8.2}
          width={1.9}
          height={4.3}
          rx={0.95}
          fill={fill('arms')}
        />
        <Rect
          x={6.6}
          y={12.7}
          width={1.8}
          height={4}
          rx={0.9}
          fill={fill('forearms')}
        />
        <Rect
          x={15.6}
          y={12.7}
          width={1.8}
          height={4}
          rx={0.9}
          fill={fill('forearms')}
        />
        <Rect
          x={9.6}
          y={15.5}
          width={2}
          height={4.1}
          rx={0.95}
          fill={fill('thighs')}
        />
        <Rect
          x={12.4}
          y={15.5}
          width={2}
          height={4.1}
          rx={0.95}
          fill={fill('thighs')}
        />
        <Rect
          x={9.7}
          y={19.7}
          width={1.8}
          height={3.4}
          rx={0.9}
          fill={fill('calves')}
        />
        <Rect
          x={12.5}
          y={19.7}
          width={1.8}
          height={3.4}
          rx={0.9}
          fill={fill('calves')}
        />
      </Svg>
    </View>
  );
}

export default React.memo(MuscleRegionBadge);
