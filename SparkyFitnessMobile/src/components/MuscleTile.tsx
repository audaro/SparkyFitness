import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

import Icon from './Icon';
import { useFreshnessToneColors } from '../hooks/useFreshnessToneColors';
import type { FreshnessTone } from '../utils/muscleRecoveryDisplay';

export interface MuscleTileProps {
  label: string;
  /**
   * Recovery as a whole percentage, 0–100, straight off `useMuscleRecovery`.
   * `null` while the recovery read is in flight or came back empty — the tile
   * still renders and is still pickable, because choosing what to train does
   * not depend on knowing how fresh it is.
   *
   * **Never the raw 0.0–1.0 `freshness`.** The ×100 happens once, in the
   * hook's `select`; converting again here would put every muscle at 1%.
   */
  percent: number | null;
  tone: FreshnessTone | null;
  selected: boolean;
  onPress: () => void;
  /**
   * Anatomical art for this muscle: the `d` attribute of the matching path in
   * `muscle-male.svg`.
   *
   * Optional because the art does not cover the whole vocabulary yet — five of
   * the seventeen muscles have no path, and adding them is a human task. Given
   * no path the tile draws a labelled colour block instead, which is what lets
   * the grid ship before the art does.
   */
  svgPath?: string;
  /** Viewport the `svgPath` coordinates are expressed in. */
  svgViewBox?: string;
  className?: string;
  testID?: string;
}

/**
 * One pickable muscle on the Pick Muscles grid, tinted by how recovered it is.
 *
 * A tile may stand for more than one canonical muscle (Back is `lats` +
 * `middle back`); it is handed a single percentage and does not know that —
 * aggregating is the screen's job, because only the screen knows which muscles
 * a tile covers.
 */
const MuscleTile: React.FC<MuscleTileProps> = ({
  label,
  percent,
  tone,
  selected,
  onPress,
  svgPath,
  svgViewBox = '0 0 100 100',
  className = '',
  testID,
}) => {
  const [accentPrimary, surfaceColor, trackColor] = useCSSVariable([
    '--color-accent-primary',
    '--color-surface',
    '--color-progress-track',
  ]) as [string, string, string];

  const toneColors = useFreshnessToneColors();
  const toneColor = tone ? toneColors[tone] : trackColor;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={
        percent === null ? label : `${label}, ${percent}% recovered`
      }
      testID={testID}
      className={`rounded-xl p-2 items-center ${className}`}
      style={({ pressed }) => ({
        backgroundColor: surfaceColor,
        borderWidth: 2,
        // A transparent border on the unselected tile keeps both states the
        // same size, so picking one does not nudge the row it sits in.
        borderColor: selected ? accentPrimary : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        className="w-full aspect-square rounded-lg items-center justify-center overflow-hidden"
        style={{ backgroundColor: trackColor }}
        testID={testID ? `${testID}-art` : undefined}
      >
        {/* The tone reads as a wash rather than a block of saturated colour.
            Drawn as its own translucent layer instead of an alpha suffix on
            the colour string: the theme's values are `hsl(...)`, and appending
            hex alpha to one yields a value React Native silently discards. */}
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: toneColor, opacity: 0.25 }]}
        />
        {svgPath ? (
          <Svg width="100%" height="100%" viewBox={svgViewBox}>
            <Path d={svgPath} fill={toneColor} />
          </Svg>
        ) : null}
        {selected ? (
          <View className="absolute top-1 right-1">
            <Icon name="checkmark-circle-filled" size={16} color={accentPrimary} />
          </View>
        ) : null}
      </View>

      <Text
        className="text-xs text-center text-text-primary mt-1.5"
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text className="text-xs font-bold" style={{ color: toneColor }}>
        {percent === null ? '—' : `${percent}%`}
      </Text>
    </Pressable>
  );
};

export default MuscleTile;
