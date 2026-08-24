/**
 * Named subsets of the free-exercise-db catalog a user can bulk-import into
 * their exercise library. Membership is defined by the catalog's own
 * `equipment` value rather than a hand-listed set of names, so a pack tracks
 * upstream additions instead of going stale.
 */
export interface ExerciseCatalogPack {
  id: string;
  label: string;
  description: string;
  /** Catalog equipment values, lowercase, that put an exercise in this pack. */
  equipment: string[];
}

export const EXERCISE_CATALOG_PACKS: readonly ExerciseCatalogPack[] = [
  {
    id: 'gym-machines',
    label: 'Gym Machines & Cables',
    description:
      'Every plate-loaded, selectorized and cable exercise in the catalog — leg press, chest press, lat pulldown, pushdowns and the rest. Each one arrives with demonstration photos.',
    equipment: ['machine', 'cable'],
  },
];

export function getExerciseCatalogPack(
  packId: string
): ExerciseCatalogPack | undefined {
  return EXERCISE_CATALOG_PACKS.find((pack) => pack.id === packId);
}
