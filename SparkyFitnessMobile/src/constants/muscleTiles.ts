import { MUSCLES, type Muscle } from '@workspace/shared';

import { MUSCLE_ART, type MuscleArt } from './muscleArt.generated';

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
 * The anatomical art for a tile, or `undefined` when the illustration does not
 * draw it.
 *
 * A tile can stand for more than one muscle, so this takes the first of them
 * the illustration knows. Today that never has to choose: the only multi-muscle
 * tile is Back (`lats` + `middle back`) and the illustration draws neither, so
 * Back is one of the five that keep the labelled colour block.
 */
export function artForTile(tile: MuscleTileDefinition): MuscleArt | undefined {
  for (const muscle of tile.muscles) {
    const art = MUSCLE_ART[muscle];
    if (art) return art;
  }
  return undefined;
}

export function musclesForTiles(
  tileIds: readonly string[],
): Muscle[] {
  const picked = new Set(tileIds);
  const selected = new Set(
    MUSCLE_TILES.filter((tile) => picked.has(tile.id)).flatMap((tile) => tile.muscles),
  );
  return MUSCLES.filter((muscle) => selected.has(muscle));
}
