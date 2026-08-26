import type { TFunction } from 'i18next';

import { MUSCLES, type Muscle } from '@workspace/shared';

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
  /**
   * Stable key and testID suffix. Kebab-case, never sent to the server. It is
   * also what {@link tileLabel} switches on to produce the displayed name —
   * there is deliberately no `label` field, so the English text lives in
   * exactly one place.
   */
  id: string;
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
  { id: 'abs', muscles: ['abdominals'] },
  { id: 'back', muscles: ['lats', 'middle back'] },
  { id: 'biceps', muscles: ['biceps'] },
  { id: 'chest', muscles: ['chest'] },
  { id: 'glutes', muscles: ['glutes'] },
  { id: 'hamstrings', muscles: ['hamstrings'] },
  { id: 'quadriceps', muscles: ['quadriceps'] },
  { id: 'shoulders', muscles: ['shoulders'] },
  { id: 'triceps', muscles: ['triceps'] },
  { id: 'lower-back', muscles: ['lower back'] },
];

const ACCESSORY_MUSCLE_TILES: readonly MuscleTileDefinition[] = [
  { id: 'calves', muscles: ['calves'] },
  { id: 'traps', muscles: ['traps'] },
  { id: 'abductors', muscles: ['abductors'] },
  { id: 'adductors', muscles: ['adductors'] },
  { id: 'forearms', muscles: ['forearms'] },
  { id: 'neck', muscles: ['neck'] },
];

/**
 * The Main/Accessory split, kept as the definitional source of `MUSCLE_TILES`.
 *
 * The titles and subtitles are no longer rendered: the picker draws the
 * anatomical figure, which covers the whole vocabulary, so no tile is listed as
 * such anywhere. The grouping is real domain information, so it stays — but
 * nothing displays it today.
 */
export const MUSCLE_TILE_SECTIONS: readonly MuscleTileSection[] = [
  {
    // i18n-audit-ignore-next-line hardcoded-ui-text -- never rendered; see the doc comment above
    title: 'Main',
    // i18n-audit-ignore-next-line hardcoded-ui-text -- never rendered; see the doc comment above
    subtitle: 'What a workout is usually built around',
    tiles: MAIN_MUSCLE_TILES,
  },
  {
    // i18n-audit-ignore-next-line hardcoded-ui-text -- never rendered; see the doc comment above
    title: 'Accessory',
    // i18n-audit-ignore-next-line hardcoded-ui-text -- never rendered; see the doc comment above
    subtitle: 'Smaller movers you add on purpose',
    tiles: ACCESSORY_MUSCLE_TILES,
  },
];

/** Every tile, in the order the grid draws them. */
export const MUSCLE_TILES: readonly MuscleTileDefinition[] =
  MUSCLE_TILE_SECTIONS.flatMap((section) => section.tiles);

/**
 * The tile a muscle belongs to.
 *
 * The body map's regions are muscles while the screen's selection is tiles, so
 * every tap goes through here. Back is the one tile covering two muscles, and
 * both of them are drawn: tapping either lights up both, which is honest, since
 * both are what the request would carry.
 */
export function tileForMuscle(muscle: Muscle): MuscleTileDefinition | undefined {
  return MUSCLE_TILES.find((tile) => tile.muscles.includes(muscle));
}

/**
 * The canonical muscles a set of picked tiles resolves to, in canonical order.
 *
 * Canonical order rather than tap order so the same selection always produces
 * the same request body — the planner is deterministic, and a payload that
 * reordered itself would make two identical picks look like two different
 * workouts in the logs.
 */
export function musclesForTiles(
  tileIds: readonly string[],
): Muscle[] {
  const picked = new Set(tileIds);
  const selected = new Set(
    MUSCLE_TILES.filter((tile) => picked.has(tile.id)).flatMap((tile) => tile.muscles),
  );
  return MUSCLES.filter((muscle) => selected.has(muscle));
}

/**
 * The displayed name of a tile.
 *
 * A `switch` over literal keys rather than `t(tile.labelKey)`: the i18n audit
 * scans `t()` keys statically, and a computed key is invisible to it — which
 * is a blocking `dynamic-i18n` finding, not a cosmetic one. This is the only
 * place a tile's English name is written, so there is nothing for it to drift
 * from; an unrecognised id falls back to the id rather than rendering blank.
 */
export function tileLabel(t: TFunction, tile: MuscleTileDefinition): string {
  switch (tile.id) {
    case 'abs':
      return t('muscleTiles.abs', { defaultValue: 'Abs' });
    case 'back':
      return t('muscleTiles.back', { defaultValue: 'Back' });
    case 'biceps':
      return t('muscleTiles.biceps', { defaultValue: 'Biceps' });
    case 'chest':
      return t('muscleTiles.chest', { defaultValue: 'Chest' });
    case 'glutes':
      return t('muscleTiles.glutes', { defaultValue: 'Glutes' });
    case 'hamstrings':
      return t('muscleTiles.hamstrings', { defaultValue: 'Hamstrings' });
    case 'quadriceps':
      return t('muscleTiles.quadriceps', { defaultValue: 'Quadriceps' });
    case 'shoulders':
      return t('muscleTiles.shoulders', { defaultValue: 'Shoulders' });
    case 'triceps':
      return t('muscleTiles.triceps', { defaultValue: 'Triceps' });
    case 'lower-back':
      return t('muscleTiles.lowerBack', { defaultValue: 'Lower Back' });
    case 'calves':
      return t('muscleTiles.calves', { defaultValue: 'Calves' });
    case 'traps':
      return t('muscleTiles.traps', { defaultValue: 'Trapezius' });
    case 'abductors':
      return t('muscleTiles.abductors', { defaultValue: 'Abductors' });
    case 'adductors':
      return t('muscleTiles.adductors', { defaultValue: 'Adductors' });
    case 'forearms':
      return t('muscleTiles.forearms', { defaultValue: 'Forearms' });
    case 'neck':
      return t('muscleTiles.neck', { defaultValue: 'Neck' });
    default:
      return tile.id;
  }
}
