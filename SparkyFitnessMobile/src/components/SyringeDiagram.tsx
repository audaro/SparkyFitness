import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';
import { syringeBarrel, type SyringeStandard } from '@workspace/shared';

/**
 * The draw, drawn. A number of units is easy to misread — 5 for 50 is one glance away — and hard
 * to picture; a barrel filled to a mark is neither. The geometry is `syringeBarrel()` in shared,
 * so this and the web component of the same name mark their barrels identically.
 *
 * It renders **horizontally**, unlike the tall syringe this was modelled on: the calculator is a
 * single column of fields, and a vertical barrel would need a second column there is no room for.
 */

/** The drawing's own coordinate space. Nothing here is in pixels; the Svg scales to its box. */
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 64;

/** The Svg has no intrinsic height, so the container fixes the ratio or it collapses to nothing. */
const VIEW_ASPECT = VIEW_WIDTH / VIEW_HEIGHT;

/** The barrel, leaving room for the flange at the plunger end and the needle at the other. */
const BARREL_X = 30;
const BARREL_WIDTH = 232;
const BARREL_Y = 10;
const BARREL_HEIGHT = 26;

const MAJOR_TICK_HEIGHT = 11;
const MINOR_TICK_HEIGHT = 6;

export default function SyringeDiagram({
  units,
  syringe,
  capacityUnits,
}: {
  /** Marks to draw to — `result.syringeUnits`. */
  units: number;
  syringe: SyringeStandard;
  /**
   * `result.syringeCapacityUnits`. Passed through rather than re-derived from the standard so a
   * custom barrel is drawn to its own scale and the picture cannot disagree with the number
   * printed beside it.
   */
  capacityUnits: number;
}) {
  const { t } = useTranslation();
  const [accentColor, barrelColor, detailColor, warningColor] = useCSSVariable([
    '--color-accent-primary',
    '--color-raised',
    '--color-text-muted',
    '--color-text-warning',
  ]) as [string, string, string, string];

  const barrel = syringeBarrel(units, syringe, capacityUnits);

  // No barrel it can draw honestly, no picture. The number beside it is the answer either way.
  if (barrel === null) return null;

  const fillWidth = BARREL_WIDTH * barrel.fill;
  // Amber when the draw does not fit, matching the warning already on screen: the picture is a
  // full barrel there, and a full barrel in the ordinary colour would read as "draw to the top"
  // for a dose the syringe cannot hold.
  const markColor = barrel.overCapacity ? warningColor : accentColor;

  return (
    <View
      style={{ aspectRatio: VIEW_ASPECT, width: '100%' }}
      testID="recon-syringe"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('medications.recon.syringeAlt', {
        defaultValue:
          'A {{syringe}} syringe barrel holding {{capacity}} units, filled to {{units}}.',
        syringe,
        capacity: barrel.capacityUnits,
        units: barrel.units,
      })}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        {/* Plunger rod and thumb flange, at the left. Decoration: it is what makes the shape
            read as a syringe rather than as a progress bar. */}
        <Rect x={0} y={19} width={4} height={8} fill={detailColor} opacity={0.4} />
        <Rect x={4} y={21} width={26} height={4} fill={detailColor} opacity={0.4} />

        {/* Needle, at the right, so the barrel fills from the needle end as it does in the hand. */}
        <Rect
          x={BARREL_X + BARREL_WIDTH}
          y={21}
          width={8}
          height={4}
          fill={detailColor}
          opacity={0.4}
        />
        <Rect
          x={BARREL_X + BARREL_WIDTH + 8}
          y={22.4}
          width={30}
          height={1.2}
          fill={detailColor}
          opacity={0.6}
        />

        <Rect
          x={BARREL_X}
          y={BARREL_Y}
          width={BARREL_WIDTH}
          height={BARREL_HEIGHT}
          rx={3}
          fill={barrelColor}
          stroke={detailColor}
          strokeOpacity={0.5}
          strokeWidth={1}
        />

        {fillWidth > 0 && (
          <Rect
            x={BARREL_X}
            y={BARREL_Y}
            width={fillWidth}
            height={BARREL_HEIGHT}
            rx={3}
            fill={markColor}
            opacity={0.3}
          />
        )}

        {barrel.ticks.map((tick) => (
          <Line
            key={tick.units}
            x1={BARREL_X + BARREL_WIDTH * tick.position}
            y1={BARREL_Y}
            x2={BARREL_X + BARREL_WIDTH * tick.position}
            y2={BARREL_Y + (tick.labelled ? MAJOR_TICK_HEIGHT : MINOR_TICK_HEIGHT)}
            stroke={detailColor}
            strokeOpacity={0.6}
            strokeWidth={tick.labelled ? 1 : 0.5}
          />
        ))}

        {barrel.ticks
          .filter((tick) => tick.labelled)
          .map((tick) => (
            <SvgText
              key={tick.units}
              x={BARREL_X + BARREL_WIDTH * tick.position}
              y={BARREL_Y + BARREL_HEIGHT + 12}
              textAnchor="middle"
              fontSize={9}
              fill={detailColor}
            >
              {String(tick.units)}
            </SvgText>
          ))}

        {/* The mark to stop at, drawn over everything so it stays visible against the fill. */}
        <Line
          x1={BARREL_X + fillWidth}
          y1={BARREL_Y - 3}
          x2={BARREL_X + fillWidth}
          y2={BARREL_Y + BARREL_HEIGHT + 3}
          stroke={markColor}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}
