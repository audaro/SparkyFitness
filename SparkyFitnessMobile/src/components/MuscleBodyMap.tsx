import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

import { useFreshnessToneColors } from '../hooks/useFreshnessToneColors';
import {
  BODY_PATHS,
  BODY_VIEWS,
  BODY_VIEW_ASPECT,
  type BodyPath,
  type BodyView,
} from '../constants/muscleArt.generated';
import type { Muscle, FreshnessTone } from '@workspace/shared';

/** "lower back" -> "Lower Back", matching how the readout beneath the figure reads. */
const labelFor = (muscle: Muscle): string =>
  muscle.replace(/\b\w/g, (letter) => letter.toUpperCase());

/** What a region announces: its name, whether it is picked, how recovered it is. */
const describe = (muscle: Muscle, percent: number | null, selected: boolean): string => {
  const parts = [labelFor(muscle)];
  if (selected) parts.push('selected');
  if (percent !== null) parts.push(`${percent}% recovered`);
  return parts.join(', ');
};

/**
 * The paths of each figure, and which of them speaks for its muscle.
 *
 * Derived once: `BODY_PATHS` is a generated constant, so there is nothing here
 * that can change between renders.
 *
 * A muscle drawn in pieces — eight paths for the quads, two per side of the
 * chest — is one control, not eight. Every piece is pressable so any part of
 * the region works, but only the first announces itself, or a screen reader
 * would read "Quadriceps" eight times over and the same testID would match
 * eight nodes. It is resolved per view because several muscles (calves,
 * forearms, shoulders, traps, abs) are drawn on both figures.
 */
interface Figure {
  readonly paths: readonly BodyPath[];
  readonly speaker: ReadonlyMap<Muscle, number>;
}

const FIGURES: Readonly<Record<BodyView, Figure>> = {
  front: figure('front'),
  back: figure('back'),
};

function figure(view: BodyView): Figure {
  const paths = BODY_PATHS.filter((path) => path.view === view);
  const speaker = new Map<Muscle, number>();
  paths.forEach((path, index) => {
    if (path.kind === 'muscle' && !speaker.has(path.muscle)) speaker.set(path.muscle, index);
  });
  return { paths, speaker };
}

/** Anatomy reads at a low opacity; a pick reads at full strength. */
const UNSELECTED_OPACITY = 0.45;
/** How far the silhouette and the outline detail step back once anything is picked. */
const DIMMED_SILHOUETTE_OPACITY = 0.6;
const DETAIL_OPACITY = 0.55;
const DIMMED_DETAIL_OPACITY = 0.3;
/**
 * The seam between the pieces a muscle is drawn in, in viewBox units — about
 * 2pt at the size a phone renders this.
 *
 * The illustration has no lines of its own: what separates the eight paths of
 * the quads is the silhouette showing through the gaps between them. A selected
 * region is opaque, so it loses that, and a muscle picked at full strength went
 * flat — one blue slab where the anatomy used to be. Drawing each path's own
 * edge back in, in the silhouette's colour, is the seam the gap used to be.
 *
 * It replaced an accent-coloured stroke, which made the flatness rather than
 * fixing it: same colour as the fill, and wide enough to close the seams it was
 * drawn over.
 */
const SEAM_STROKE_WIDTH = 1.6;
const HALO_STROKE_WIDTH = 9;
const HALO_OPACITY = 0.3;

export interface MuscleBodyMapProps {
  /** Which figure to draw. One at a time — see `BODY_VIEWS`. */
  view: BodyView;
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
 * The anatomical figure on Pick Muscles: one view at a time, with every region
 * tappable as the muscle it draws.
 *
 * Fill carries both recovery and selection, and that is deliberate. Fill used
 * to carry recovery alone while a stroke carried selection, and at the size a
 * phone renders this, neither signal survived: a 2-unit stroke in a 535-unit
 * viewBox is under a point, and 0.85 opacity against 1.0 is not a visible
 * difference. So a pick is now an accent fill at full strength under a halo —
 * the same path redrawn beneath itself with a thick, low-opacity stroke, which
 * is the cheapest way to get a glow given SVG cannot union paths — and the
 * exact recovery percentage moved to the readout beneath the figure, where it
 * can actually be read. Hue still carries recovery for everything unpicked.
 *
 * An opaque fill costs the anatomy, though: the illustration separates the
 * pieces of a muscle by leaving gaps for the silhouette to show through, and
 * covering those turns a pick into a flat slab. So each selected path also
 * draws its own edge back in — see `SEAM_STROKE_WIDTH`.
 *
 * Selection state is shared across the two views: a muscle simply appears on
 * whichever figure draws it.
 */
const MuscleBodyMap: React.FC<MuscleBodyMapProps> = ({
  view,
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
  const { paths, speaker } = FIGURES[view];
  // Picks only lift off the body if the body steps back for them.
  const anySelected = selected.length > 0;

  return (
    // The figure keeps the illustration's own proportions; without an explicit
    // ratio the Svg has no intrinsic height and collapses to nothing.
    <View testID={testID} style={{ width: '100%', aspectRatio: BODY_VIEW_ASPECT }}>
      <Svg width="100%" height="100%" viewBox={BODY_VIEWS[view].viewBox}>
        {paths.map((path, index) => {
          if (path.kind === 'silhouette') {
            return (
              <Path
                key={index}
                d={path.d}
                fill={silhouetteColor}
                opacity={anySelected ? DIMMED_SILHOUETTE_OPACITY : 1}
              />
            );
          }
          if (path.kind === 'detail') {
            return (
              <Path
                key={index}
                d={path.d}
                fill={detailColor}
                opacity={anySelected ? DIMMED_DETAIL_OPACITY : DETAIL_OPACITY}
              />
            );
          }

          const entry = recoveryByMuscle.get(path.muscle);
          const isSelected = selectedSet.has(path.muscle);
          const speaks = speaker.get(path.muscle) === index;
          const region = (
            <Path
              key={index}
              d={path.d}
              fill={isSelected ? accentPrimary : entry ? toneColors[entry.tone] : trackColor}
              // Every path of a muscle carries the handler, so tapping any part
              // of a region the illustration draws in pieces picks the whole
              // muscle.
              onPress={() => onToggle(path.muscle)}
              stroke={isSelected ? silhouetteColor : undefined}
              strokeWidth={isSelected ? SEAM_STROKE_WIDTH : 0}
              strokeLinejoin="round"
              opacity={isSelected ? 1 : UNSELECTED_OPACITY}
              accessible={speaks}
              // `react-native-svg` passes only `accessible` and
              // `accessibilityLabel` through to a path — there is no role or
              // checked state to set — so both have to be said in the label.
              accessibilityLabel={
                speaks ? describe(path.muscle, entry?.percent ?? null, isSelected) : undefined
              }
              testID={speaks && testID ? `${testID}-${path.muscle}` : undefined}
            />
          );

          if (!isSelected) return region;
          return (
            <React.Fragment key={index}>
              <Path
                d={path.d}
                fill="none"
                stroke={accentPrimary}
                strokeWidth={HALO_STROKE_WIDTH}
                strokeOpacity={HALO_OPACITY}
                strokeLinejoin="round"
                // The glow is decoration around the region, not a wider version
                // of it: letting it take taps would steal them from whatever is
                // drawn next door.
                pointerEvents="none"
              />
              {region}
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
};

export default MuscleBodyMap;
