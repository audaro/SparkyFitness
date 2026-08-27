/**
 * Named subsets of an exercise catalog a user can bulk-import into their
 * exercise library. Membership is defined by the catalog's own `equipment`
 * value rather than a hand-listed set of names, so a pack tracks upstream
 * additions instead of going stale.
 */
export type ExerciseCatalogPackSource = 'free-exercise-db' | 'exercisedb';

export interface ExerciseCatalogPack {
  id: string;
  label: string;
  description: string;
  /** Which upstream catalog the pack draws from. */
  source: ExerciseCatalogPackSource;
  /** Catalog equipment values, lowercase, that put an exercise in this pack. */
  equipment: string[];
}

export const EXERCISE_CATALOG_PACKS: readonly ExerciseCatalogPack[] = [
  {
    id: 'gym-machines',
    label: 'Gym Machines & Cables',
    description:
      'Every plate-loaded, selectorized and cable exercise in the catalog — leg press, chest press, lat pulldown, pushdowns and the rest. Each one arrives with demonstration photos.',
    source: 'free-exercise-db',
    equipment: ['machine', 'cable'],
  },
  {
    id: 'exercisedb-machines',
    label: 'Machine Exercises (Extended)',
    description:
      'A second catalog with far deeper machine coverage — lever chest press, lateral raise, torso rotation, back extension, hip thrust, hack squat, Smith machine variations and more. Each one arrives with a photo and an animated demonstration.',
    source: 'exercisedb',
    equipment: ['leverage machine', 'smith machine', 'sled machine'],
  },
];

export function getExerciseCatalogPack(
  packId: string
): ExerciseCatalogPack | undefined {
  return EXERCISE_CATALOG_PACKS.find((pack) => pack.id === packId);
}
