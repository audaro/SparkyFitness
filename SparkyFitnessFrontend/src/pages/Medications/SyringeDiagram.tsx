import { useTranslation } from 'react-i18next';
import { syringeBarrel, type SyringeStandard } from '@workspace/shared';

/**
 * The draw, drawn. A number of units is easy to misread — 5 for 50 is one glance away — and hard
 * to picture; a barrel filled to a mark is neither. The geometry is `syringeBarrel()` in shared,
 * so this and the mobile component of the same name mark their barrels identically.
 *
 * **Position 0 is the needle end**, which is what fixes both ends of every drawing here: the 0
 * graduation sits where the stopper rests on an empty syringe, which is against the needle, and
 * the liquid occupies the barrel between the needle and the stopper. So the fill always grows
 * *away* from the needle and the numbers always count up in the same direction. Drawing it the
 * other way round still puts the mark on the right number — the answer survives — but it renders
 * a syringe nobody has ever held.
 *
 * Two orientations, because the two callers have different room. `vertical` is the tall syringe
 * this was modelled on and wants a column beside it for the numbers; `horizontal` is the default
 * because it drops into a single column of form fields, which is all mobile has.
 */

export type SyringeOrientation = 'horizontal' | 'vertical';

/**
 * The drawing's own coordinate space, per orientation. Nothing here is in pixels; the SVG scales
 * to whatever box it is given. `barrel` is the graduated tube; the needle sits at its 0 end and
 * the plunger rod and thumb flange at the other.
 */
const GEOMETRY = {
  horizontal: {
    viewWidth: 300,
    viewHeight: 64,
    barrelX: 38,
    barrelY: 10,
    barrelWidth: 232,
    barrelHeight: 26,
  },
  vertical: {
    viewWidth: 96,
    viewHeight: 300,
    barrelX: 14,
    barrelY: 38,
    barrelWidth: 26,
    barrelHeight: 232,
  },
} as const;

const MAJOR_TICK_LENGTH = 11;
const MINOR_TICK_LENGTH = 6;

/** Half the barrel's short side, i.e. the middle of the tube the needle and rod line up with. */
const AXIS_OFFSET = 13;

export default function SyringeDiagram({
  units,
  syringe,
  capacityUnits,
  orientation = 'horizontal',
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
  orientation?: SyringeOrientation;
}) {
  const { t } = useTranslation();
  const barrel = syringeBarrel(units, syringe, capacityUnits);

  // No barrel it can draw honestly, no picture. The number beside it is the answer either way.
  if (barrel === null) return null;

  const g = GEOMETRY[orientation];
  const vertical = orientation === 'vertical';

  // How far along the barrel the fill reaches, from the needle end.
  const fillLength = (vertical ? g.barrelHeight : g.barrelWidth) * barrel.fill;

  // The needle end of the barrel, and the direction the graduations run in from it. Vertical
  // hangs needle-up so the drawn liquid sits at the top, as it does when you hold it to expel air.
  const originX = g.barrelX;
  const originY = g.barrelY;
  const along = (fraction: number) =>
    vertical
      ? { x: originX, y: originY + g.barrelHeight * fraction }
      : { x: originX + g.barrelWidth * fraction, y: originY };

  const fillEnd = along(barrel.fill);
  const label = t(
    'medications.recon.syringeAlt',
    'A {{syringe}} syringe barrel holding {{capacity}} units, filled to {{units}}.',
    { syringe, capacity: barrel.capacityUnits, units: barrel.units }
  );

  return (
    <figure className="m-0" data-testid="recon-syringe">
      <svg
        viewBox={`0 0 ${g.viewWidth} ${g.viewHeight}`}
        className={vertical ? 'h-full w-auto' : 'h-auto w-full'}
        role="img"
        aria-label={label}
      >
        {/* Needle at the 0 end of the barrel, and the plunger rod and thumb flange at the other.
            Decoration, but the kind that carries meaning: it is what makes the shape read as a
            syringe rather than as a progress bar, and it is what says which end the fill is at. */}
        {vertical ? (
          <>
            <rect
              x={originX + AXIS_OFFSET - 0.6}
              y={0}
              width={1.2}
              height={30}
              className="fill-muted-foreground/60"
            />
            <rect
              x={originX + AXIS_OFFSET - 2}
              y={30}
              width={4}
              height={8}
              className="fill-muted-foreground/40"
            />
            <rect
              x={originX + AXIS_OFFSET - 2}
              y={g.barrelY + g.barrelHeight}
              width={4}
              height={4}
              className="fill-muted-foreground/40"
            />
            <rect
              x={originX - 4}
              y={g.barrelY + g.barrelHeight + 4}
              width={g.barrelWidth + 8}
              height={4}
              className="fill-muted-foreground/40"
            />
          </>
        ) : (
          <>
            <rect
              x={0}
              y={g.barrelY + AXIS_OFFSET - 0.6}
              width={30}
              height={1.2}
              className="fill-muted-foreground/60"
            />
            <rect
              x={30}
              y={g.barrelY + AXIS_OFFSET - 2}
              width={8}
              height={4}
              className="fill-muted-foreground/40"
            />
            <rect
              x={g.barrelX + g.barrelWidth}
              y={g.barrelY + AXIS_OFFSET - 2}
              width={4}
              height={4}
              className="fill-muted-foreground/40"
            />
            <rect
              x={g.barrelX + g.barrelWidth + 4}
              y={g.barrelY - 4}
              width={4}
              height={g.barrelHeight + 8}
              className="fill-muted-foreground/40"
            />
          </>
        )}

        <rect
          x={g.barrelX}
          y={g.barrelY}
          width={g.barrelWidth}
          height={g.barrelHeight}
          rx={3}
          className="fill-background stroke-muted-foreground/50"
          strokeWidth={1}
        />

        {fillLength > 0 && (
          <rect
            x={g.barrelX}
            y={g.barrelY}
            width={vertical ? g.barrelWidth : fillLength}
            height={vertical ? fillLength : g.barrelHeight}
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
          const at = along(tick.position);
          const length = tick.labelled ? MAJOR_TICK_LENGTH : MINOR_TICK_LENGTH;
          return (
            <line
              key={tick.units}
              x1={at.x}
              y1={at.y}
              x2={vertical ? at.x + length : at.x}
              y2={vertical ? at.y : at.y + length}
              className="stroke-muted-foreground/60"
              strokeWidth={tick.labelled ? 1 : 0.5}
            />
          );
        })}

        {barrel.ticks
          .filter((tick) => tick.labelled)
          .map((tick) => {
            const at = along(tick.position);
            return (
              <text
                key={tick.units}
                x={vertical ? g.barrelX + g.barrelWidth + 4 : at.x}
                y={vertical ? at.y : g.barrelY + g.barrelHeight + 12}
                textAnchor={vertical ? 'start' : 'middle'}
                dominantBaseline={vertical ? 'middle' : 'auto'}
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {tick.units}
              </text>
            );
          })}

        {/* The mark to stop at, drawn over everything so it stays visible against the fill. */}
        <line
          x1={vertical ? g.barrelX - 3 : fillEnd.x}
          y1={vertical ? fillEnd.y : g.barrelY - 3}
          x2={vertical ? g.barrelX + g.barrelWidth + 3 : fillEnd.x}
          y2={vertical ? fillEnd.y : g.barrelY + g.barrelHeight + 3}
          className={
            barrel.overCapacity ? 'stroke-amber-600' : 'stroke-primary'
          }
          strokeWidth={2}
        />
      </svg>
    </figure>
  );
}
