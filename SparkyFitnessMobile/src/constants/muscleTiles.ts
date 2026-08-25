import { MUSCLES, type Muscle } from '@workspace/shared';

import { MUSCLES_ON_BODY } from './muscleArt.generated';

/**
 * How the 17 canonical muscles are grouped into tiles on the muscle grid.
 *
 * **Display only.** The wire carries canonical single muscles — a request built
 * from the Back tile sends `["lats", "middle back"]`, never `"back"`, because
 * catalog matching is `::jsonb ?|`, exact and case-sensitive. This file exists
 * so the grid can read like a body without the vocabulary drifting from the
 * server's.
 *
 * The Main / Accessory split is about how a user picks, not about anatomy: the
 * ten Main tiles are what a session is normally built around, and the six
 * Accessory ones are the muscles you add deliberately. Every canonical muscle
 * appears in exactly one tile — `__tests__/constants/muscleTiles.test.ts`
 * asserts that partition, so a muscle added upstream fails the suite here
 * rather than silently becoming unpickable.
 */
export interface MuscleTileDefinition {
  /** Stable key and testID suffix. Kebab-case, never sent to the server. */
  id: string;
  label: string;
  /** The canonical muscles this tile stands for — what actually goes on the wire. */
  muscles: readonly Muscle[];
}

export interface MuscleTileSection {
  title: string;
  subtitle: string;
  tiles: readonly MuscleTileDefinition[];
}

/**
 * `lats` and `middle back` share one tile: "back" is one thing to a user
 * choosing what to train, and offering them separately would ask for a
 * distinction most people cannot make about their own body. Both muscles ride
 * along in the request, so the planner still sees them individually.
 */
const MAIN_MUSCLE_TILES: readonly MuscleTileDefinition[] = [
  { id: 'abs', label: 'Abs', muscles: ['abdominals'] },
  { id: 'back', label: 'Back', muscles: ['lats', 'middle back'] },
  { id: 'biceps', label: 'Biceps', muscles: ['biceps'] },
  { id: 'chest', label: 'Chest', muscles: ['chest'] },
  { id: 'glutes', label: 'Glutes', muscles: ['glutes'] },
  { id: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'] },
  { id: 'quadriceps', label: 'Quadriceps', muscles: ['quadriceps'] },
  { id: 'shoulders', label: 'Shoulders', muscles: ['shoulders'] },
  { id: 'triceps', label: 'Triceps', muscles: ['triceps'] },
  { id: 'lower-back', label: 'Lower Back', muscles: ['lower back'] },
];

const ACCESSORY_MUSCLE_TILES: readonly MuscleTileDefinition[] = [
  { id: 'calves', label: 'Calves', muscles: ['calves'] },
  { id: 'traps', label: 'Trapezius', muscles: ['traps'] },
  { id: 'abductors', label: 'Abductors', muscles: ['abductors'] },
  { id: 'adductors', label: 'Adductors', muscles: ['adductors'] },
  { id: 'forearms', label: 'Forearms', muscles: ['forearms'] },
  { id: 'neck', label: 'Neck', muscles: ['neck'] },
];

/**
 * The Main/Accessory split, kept as the definitional source of `MUSCLE_TILES`.
 *
 * The titles and subtitles are no longer rendered: the picker draws the
 * anatomical figure instead of a sectioned tile grid, and the only tiles it
 * still lists as such are the four with no region on it. The grouping is real
 * domain information, so it stays — but nothing displays it today.
 */
export const MUSCLE_TILE_SECTIONS: readonly MuscleTileSection[] = [
  {
    title: 'Main',
    subtitle: 'What a workout is usually built around',
    tiles: MAIN_MUSCLE_TILES,
  },
  {
    title: 'Accessory',
    subtitle: 'Smaller movers you add on purpose',
    tiles: ACCESSORY_MUSCLE_TILES,
  },
];

/** Every tile, in the order the grid draws them. */
export const MUSCLE_TILES: readonly MuscleTileDefinition[] =
  MUSCLE_TILE_SECTIONS.flatMap((section) => section.tiles);

/**
 * The canonical muscles a set of picked tiles resolves to, in canonical order.
 *
 * Canonical order rather than tap order so the same selection always produces
 * the same request body — the planner is deterministic, and a payload that
 * reordered itself would make two identical picks look like two different
 * workouts in the logs.
 */
/**
 * The tiles the body map cannot offer, because the illustration draws no region
 * for any muscle they cover. Pick Muscles lists these as chips beneath the
 * figure so the vocabulary stays fully reachable.
 *
 * Every tile is wholly on the figure or wholly off it — never split — which
 * `__tests__/constants/muscleArt.test.ts` asserts, since a half-drawn tile
 * would be tappable on the body *and* listed as missing from it.
 */
/**
 * The tile a muscle belongs to. Used by the body map, whose regions are muscles
 * while the screen's selection is tiles.
 */
export function tileForMuscle(muscle: Muscle): MuscleTileDefinition | undefined {
  return MUSCLE_TILES.find((tile) => tile.muscles.includes(muscle));
}

export const TILES_OFF_BODY: readonly MuscleTileDefinition[] = MUSCLE_TILES.filter((tile) =>
  tile.muscles.every((muscle) => !MUSCLES_ON_BODY.includes(muscle)),
);

export function musclesForTiles(
  tileIds: readonly string[],
): Muscle[] {
  const picked = new Set(tileIds);
  const selected = new Set(
    MUSCLE_TILES.filter((tile) => picked.has(tile.id)).flatMap((tile) => tile.muscles),
  );
  return MUSCLES.filter((muscle) => selected.has(muscle));
}
