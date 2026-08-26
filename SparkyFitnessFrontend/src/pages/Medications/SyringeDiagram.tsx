import { useTranslation } from 'react-i18next';
import { syringeBarrel, type SyringeStandard } from '@workspace/shared';

/**
 * The draw, drawn. A number of units is easy to misread — 5 for 50 is one glance away — and hard
 * to picture; a barrel filled to a mark is neither. The geometry is `syringeBarrel()` in shared,
 * so this and the mobile component of the same name mark their barrels identically.
 *
 * It renders **horizontally**, unlike the tall syringe this was modelled on: the calculator is a
 * single column of fields on both platforms, and a vertical barrel would need a second column
 * that mobile does not have.
 */

/** The drawing's own coordinate space. Nothing about it is in pixels; the SVG scales to its box. */
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 64;

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
  const barrel = syringeBarrel(units, syringe, capacityUnits);

  // No barrel it can draw honestly, no picture. The number above it is the answer either way.
  if (barrel === null) return null;

  const fillWidth = BARREL_WIDTH * barrel.fill;

  return (
    <figure className="m-0" data-testid="recon-syringe">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={t(
          'medications.recon.syringeAlt',
          'A {{syringe}} syringe barrel holding {{capacity}} units, filled to {{units}}.',
          {
            syringe,
            capacity: barrel.capacityUnits,
            units: barrel.units,
          }
        )}
      >
        {/* Plunger rod and thumb flange, at the left. Decoration: it is what makes the shape
            read as a syringe rather than as a progress bar. */}
        <rect
          x={0}
          y={19}
          width={4}
          height={8}
          className="fill-muted-foreground/40"
        />
        <rect
          x={4}
          y={21}
          width={26}
          height={4}
          className="fill-muted-foreground/40"
        />

        {/* Needle, at the right, so the barrel fills from the needle end as it does in the hand. */}
        <rect
          x={BARREL_X + BARREL_WIDTH}
          y={21}
          width={8}
          height={4}
          className="fill-muted-foreground/40"
        />
        <rect
          x={BARREL_X + BARREL_WIDTH + 8}
          y={22.4}
          width={30}
          height={1.2}
          className="fill-muted-foreground/60"
        />

        <rect
          x={BARREL_X}
          y={BARREL_Y}
          width={BARREL_WIDTH}
          height={BARREL_HEIGHT}
          rx={3}
          className="fill-background stroke-muted-foreground/50"
          strokeWidth={1}
        />

        {fillWidth > 0 && (
          <rect
            x={BARREL_X}
            y={BARREL_Y}
            width={fillWidth}
            height={BARREL_HEIGHT}
            rx={3}
            // Amber when the draw does not fit, matching the warning already on screen: the
            // picture is a full barrel there, and a full barrel in the ordinary colour would
            // read as "draw to the top" for a dose the syringe cannot hold.
            className={
              barrel.overCapacity ? 'fill-amber-500/40' : 'fill-primary/30'
            }
          />
        )}

        {barrel.ticks.map((tick) => {
          const x = BARREL_X + BARREL_WIDTH * tick.position;
          const height = tick.labelled ? MAJOR_TICK_HEIGHT : MINOR_TICK_HEIGHT;
          return (
            <line
              key={tick.units}
              x1={x}
              y1={BARREL_Y}
              x2={x}
              y2={BARREL_Y + height}
              className="stroke-muted-foreground/60"
              strokeWidth={tick.labelled ? 1 : 0.5}
            />
          );
        })}

        {barrel.ticks
          .filter((tick) => tick.labelled)
          .map((tick) => (
            <text
              key={tick.units}
              x={BARREL_X + BARREL_WIDTH * tick.position}
              y={BARREL_Y + BARREL_HEIGHT + 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px] tabular-nums"
            >
              {tick.units}
            </text>
          ))}

        {/* The mark to stop at, drawn over everything so it stays visible against the fill. */}
        <line
          x1={BARREL_X + fillWidth}
          y1={BARREL_Y - 3}
          x2={BARREL_X + fillWidth}
          y2={BARREL_Y + BARREL_HEIGHT + 3}
          className={
            barrel.overCapacity ? 'stroke-amber-600' : 'stroke-primary'
          }
          strokeWidth={2}
        />
      </svg>
    </figure>
  );
}
