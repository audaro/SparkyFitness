import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

import { useFreshnessToneColors } from '../hooks/useFreshnessToneColors';
import { BODY_PATHS, BODY_VIEW_BOX } from '../constants/muscleArt.generated';
import type { Muscle, FreshnessTone } from '@workspace/shared';

/** "lower back" -> "Lower Back", matching how the chips beneath the figure read. */
const labelFor = (muscle: Muscle): string =>
  muscle.replace(/\b\w/g, (letter) => letter.toUpperCase());

/** What a region announces: its name, whether it is picked, how recovered it is. */
const describe = (muscle: Muscle, percent: number | null, selected: boolean): string => {
  const parts = [labelFor(muscle)];
  if (selected) parts.push('selected');
  if (percent !== null) parts.push(`${percent}% recovered`);
  return parts.join(', ');
};

const [, , VIEW_BOX_WIDTH, VIEW_BOX_HEIGHT] = BODY_VIEW_BOX.split(' ').map(Number);
const VIEW_BOX_RATIO = VIEW_BOX_WIDTH / VIEW_BOX_HEIGHT;

export interface MuscleBodyMapProps {
  /**
   * How recovered each muscle is — the `percent`/`tone` pair `useMuscleRecovery`
   * already derived. A muscle missing from the map draws in the neutral track
   * colour and announces no percentage: unknown, not fully fatigued.
   *
   * **Never the raw 0.0–1.0 `freshness`.** The ×100 happens once, in the hook's
   * `select`.
   */
  recoveryByMuscle: ReadonlyMap<Muscle, { percent: number; tone: FreshnessTone }>;
  selected: readonly Muscle[];
  onToggle: (muscle: Muscle) => void;
  testID?: string;
}

/**
 * The anatomical figure on Pick Muscles: front and back side by side, with
 * every labelled region tappable as the muscle it draws.
 *
 * Regions are tinted by recovery and outlined when picked. Selection is a
 * stroke rather than a different fill because the fill is already carrying
 * recovery — overwriting it to show selection would mean the muscles you chose
 * are the ones whose freshness you can no longer see.
 *
 * The figure covers twelve of the seventeen canonical muscles. The rest have no
 * region here at all; offering them is the screen's job, not this component's.
 */
const MuscleBodyMap: React.FC<MuscleBodyMapProps> = ({
  recoveryByMuscle,
  selected,
  onToggle,
  testID,
}) => {
  const [accentPrimary, silhouetteColor, detailColor, trackColor] = useCSSVariable([
    '--color-accent-primary',
    '--color-surface',
    '--color-text-secondary',
    '--color-progress-track',
  ]) as [string, string, string, string];

  const toneColors = useFreshnessToneColors();
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /**
   * The first path index for each muscle, which is the one that carries the
   * accessibility identity and the testID.
   *
   * The illustration draws a muscle in pieces — eight for the quads, two per
   * side of the chest — and every piece is pressable so any part of the region
   * works. But only one of them announces itself, or a screen reader would read
   * "Quadriceps, checkbox" eight times over and the same testID would match
   * eight nodes.
   */
  const labelledIndex = useMemo(() => {
    const first = new Map<Muscle, number>();
    BODY_PATHS.forEach((path, index) => {
      if (path.kind === 'muscle' && !first.has(path.muscle)) first.set(path.muscle, index);
    });
    return first;
  }, []);

  return (
    // The figure keeps the illustration's own proportions; without an explicit
    // ratio the Svg has no intrinsic height and collapses to nothing.
    <View testID={testID} style={{ width: '100%', aspectRatio: VIEW_BOX_RATIO }}>
      <Svg width="100%" height="100%" viewBox={BODY_VIEW_BOX}>
        {BODY_PATHS.map((path, index) => {
          if (path.kind === 'silhouette') {
            return <Path key={index} d={path.d} fill={silhouetteColor} />;
          }
          if (path.kind === 'detail') {
            return <Path key={index} d={path.d} fill={detailColor} opacity={0.55} />;
          }

          const entry = recoveryByMuscle.get(path.muscle);
          const isSelected = selectedSet.has(path.muscle);
          const isLabelled = labelledIndex.get(path.muscle) === index;
          return (
            <Path
              key={index}
              d={path.d}
              fill={entry ? toneColors[entry.tone] : trackColor}
              // Every path of a muscle carries the handler, so tapping any part
              // of a region the illustration draws in pieces picks the whole
              // muscle.
              onPress={() => onToggle(path.muscle)}
              stroke={isSelected ? accentPrimary : undefined}
              strokeWidth={isSelected ? 2 : 0}
              opacity={isSelected ? 1 : 0.85}
              accessible={isLabelled}
              // `react-native-svg` passes only `accessible` and
              // `accessibilityLabel` through to a path — there is no role or
              // checked state to set — so both have to be said in the label.
              accessibilityLabel={
                isLabelled
                  ? describe(path.muscle, entry?.percent ?? null, isSelected)
                  : undefined
              }
              testID={isLabelled && testID ? `${testID}-${path.muscle}` : undefined}
            />
          );
        })}
      </Svg>
    </View>
  );
};

export default MuscleBodyMap;
