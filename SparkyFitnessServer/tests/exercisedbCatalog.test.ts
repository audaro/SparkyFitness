import { describe, expect, it } from 'vitest';
import {
  EXERCISEDB_EQUIPMENT_TO_COARSE,
  EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID,
  EXERCISEDB_MECHANIC_BY_SOURCE_ID,
  EXERCISEDB_SECONDARY_TO_MUSCLE,
  EXERCISEDB_SOURCE,
  EXERCISEDB_TARGET_TO_MUSCLE,
  EQUIPMENT,
  EQUIPMENT_ITEMS,
  EXERCISE_MECHANICS,
  MUSCLES,
  isKnownEquipmentItem,
  requiredItemsFor,
} from '@workspace/shared';
import { EXERCISEDB_CATALOG } from './fixtures/exercisedbCatalog.js';

/**
 * The ExerciseDB-mirror classification vocabulary
 * (`shared/src/constants/exercisedb.ts`), tested from here because `shared/`
 * has no test runner.
 *
 * Same philosophy as equipmentItems.test.ts: the maps are only correct
 * relative to the catalog they classify, so the pinned snapshot fixture is
 * the other half of every assertion. A catalog tag the maps do not decide
 * would let the importer guess, and a curated key naming no real row would
 * silently gate nothing.
 */

describe('exercisedb catalog snapshot', () => {
  it('is the 1324-row catalog captured 2026-08-27', () => {
    expect(Object.keys(EXERCISEDB_CATALOG).length).toBe(1324);
  });
});

describe('EXERCISEDB_EQUIPMENT_TO_COARSE', () => {
  it('decides every equipment tag the catalog uses, with no stale keys', () => {
    const inCatalog = new Set(
      Object.values(EXERCISEDB_CATALOG).map((row) => row.equipment)
    );
    expect([...inCatalog].sort()).toEqual(
      Object.keys(EXERCISEDB_EQUIPMENT_TO_COARSE).sort()
    );
  });

  it('maps onto the canonical coarse vocabulary only', () => {
    const canonical = new Set<string>(EQUIPMENT);
    for (const [tag, coarse] of Object.entries(
      EXERCISEDB_EQUIPMENT_TO_COARSE
    )) {
      if (coarse === null) continue;
      expect(canonical.has(coarse), `${tag} -> ${coarse}`).toBe(true);
    }
  });
});

describe('exercisedb muscle maps', () => {
  it('decides every target the catalog uses, with no stale keys', () => {
    const inCatalog = new Set(
      Object.values(EXERCISEDB_CATALOG).map((row) => row.target)
    );
    expect([...inCatalog].sort()).toEqual(
      Object.keys(EXERCISEDB_TARGET_TO_MUSCLE).sort()
    );
  });

  it('maps targets and secondaries onto canonical muscles only', () => {
    const canonical = new Set<string>(MUSCLES);
    for (const [raw, muscle] of [
      ...Object.entries(EXERCISEDB_TARGET_TO_MUSCLE),
      ...Object.entries(EXERCISEDB_SECONDARY_TO_MUSCLE),
    ]) {
      if (muscle === null) continue;
      expect(canonical.has(muscle), `${raw} -> ${muscle}`).toBe(true);
    }
  });

  it('skips only the cardio target', () => {
    const skipped = Object.entries(EXERCISEDB_TARGET_TO_MUSCLE)
      .filter(([, muscle]) => muscle === null)
      .map(([raw]) => raw);
    expect(skipped).toEqual(['cardiovascular system']);
  });
});

describe('EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID', () => {
  it('keys only real rows of the pinned catalog', () => {
    for (const key of Object.keys(EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID)) {
      expect(
        Object.prototype.hasOwnProperty.call(EXERCISEDB_CATALOG, key),
        `${key} is not a catalog row`
      ).toBe(true);
    }
  });

  it('maps only defined item slugs', () => {
    for (const [key, slugs] of Object.entries(
      EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID
    )) {
      for (const slug of slugs) {
        expect(isKnownEquipmentItem(slug), `${key} -> ${slug}`).toBe(true);
      }
    }
  });

  it('classifies the whole machines family', () => {
    // Every leverage/smith/sled row is either curated or on this explicit
    // list: cardio rows the muscle map skips anyway, plus the two stations
    // none of our items honestly is (they fall to the generic any-machine
    // default). A new machine row appearing uncurated must be decided here.
    const deliberatelyGeneric = new Set([
      '0578', // lever deadlift
      '2288', // lever gripper hands
      '0798', // stationary bike walk (cardio target)
      '2331', // cycle cross trainer (cardio target)
      '3666', // walking on incline treadmill (cardio target)
    ]);
    const machineFamily = Object.entries(EXERCISEDB_CATALOG).filter(([, row]) =>
      ['leverage machine', 'smith machine', 'sled machine'].includes(
        row.equipment
      )
    );
    expect(machineFamily.length).toBe(144);
    for (const [id] of machineFamily) {
      const decided =
        EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID[id] !== undefined ||
        deliberatelyGeneric.has(id);
      expect(decided, `machine-family row ${id} is undecided`).toBe(true);
    }
  });

  it('puts rows behind the four previously row-less stations', () => {
    const counts = new Map<string, number>();
    for (const slugs of Object.values(
      EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID
    )) {
      for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    // The whole point of the second source: these items gated nothing in
    // free-exercise-db.
    expect(counts.get('lateral-raise-machine')).toBe(1);
    expect(counts.get('torso-rotation-machine')).toBe(1);
    expect(counts.get('back-extension-machine')).toBe(2);
    expect(counts.get('glute-machine')).toBe(1);
    // And the map as a whole cannot silently shrink.
    expect(Object.keys(EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID).length).toBe(
      143
    );
  });

  it('keeps every curated row inside a bucket its items can reach', () => {
    // Mirror of the free-exercise-db reachability rule: a row's coarse
    // bucket must be derivable from at least one satisfying item, or an
    // item-stated profile could pass the item gate and still lose the row
    // to the coarse subset test.
    //
    // The lever pulldown/pullover rows are deliberate cross-layer ANDs, the
    // same shape as free-exercise-db's Weighted_Bench_Dip: the honest item
    // is a pulldown station (which derives `cable`), but the row sits in the
    // `machine` bucket, so it additionally needs any machine-deriving item
    // for the coarse layer. A cable-only garage rig stays out; a real
    // machine floor with a pulldown gets them.
    const crossLayerAnd = new Set(['0579', '0673', '1347', '2285', '2736']);
    for (const [key, slugs] of Object.entries(
      EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID
    )) {
      if (crossLayerAnd.has(key)) continue;
      const bucket =
        EXERCISEDB_EQUIPMENT_TO_COARSE[EXERCISEDB_CATALOG[key].equipment];
      if (bucket === null || bucket === 'body only') continue;
      if (slugs.length === 0) continue;
      const reachable = slugs.some((slug) =>
        (
          EQUIPMENT_ITEMS.find((item) => item.slug === slug)?.derives as
            | readonly string[]
            | undefined
        )?.includes(bucket)
      );
      expect(reachable, `${key} (${bucket}) unreachable via ${slugs}`).toBe(
        true
      );
    }
  });
});

describe('EXERCISEDB_MECHANIC_BY_SOURCE_ID', () => {
  // The pack the importer actually walks: the machine family, minus the rows
  // whose target the muscle map skips (they never reach the importer).
  const packMembers = Object.entries(EXERCISEDB_CATALOG)
    .filter(([, row]) =>
      ['leverage machine', 'smith machine', 'sled machine'].includes(
        row.equipment
      )
    )
    .filter(([, row]) => {
      // null is the cardio target the muscle map deliberately skips; undefined
      // cannot happen for a catalog row (asserted above) but is excluded
      // explicitly rather than through a loose `!= null`.
      const muscle = EXERCISEDB_TARGET_TO_MUSCLE[row.target];
      return muscle !== null && muscle !== undefined;
    })
    .map(([id]) => id);

  it('decides every pack member, with no stale keys', () => {
    // Totality is the whole point. The mirror has no mechanic field, so a row
    // this map misses is stored with mechanic NULL — which `isCompound` reads
    // as an isolation, quietly barring a machine press from ever opening a
    // workout. That failure is invisible at import time, so it is caught here.
    expect(packMembers.length).toBe(141);
    for (const id of packMembers) {
      expect(
        EXERCISEDB_MECHANIC_BY_SOURCE_ID[id],
        `pack member ${id} has no curated mechanic`
      ).toBeDefined();
    }
    for (const id of Object.keys(EXERCISEDB_MECHANIC_BY_SOURCE_ID)) {
      expect(
        packMembers,
        `curated mechanic ${id} names no pack member`
      ).toContain(id);
    }
  });

  it('uses the canonical mechanic vocabulary only', () => {
    for (const value of Object.values(EXERCISEDB_MECHANIC_BY_SOURCE_ID)) {
      expect(EXERCISE_MECHANICS).toContain(value);
    }
  });

  it('calls the pressing stations compound and the flyes isolation', () => {
    // Spot-check of the rows this map exists for: the machine chest press was
    // the movement a NULL mechanic locked out of the chest slot.
    expect(EXERCISEDB_MECHANIC_BY_SOURCE_ID['0577']).toBe('compound');
    expect(EXERCISEDB_MECHANIC_BY_SOURCE_ID['0603']).toBe('compound');
    expect(EXERCISEDB_MECHANIC_BY_SOURCE_ID['0748']).toBe('compound');
    expect(EXERCISEDB_MECHANIC_BY_SOURCE_ID['0596']).toBe('isolation');
    expect(EXERCISEDB_MECHANIC_BY_SOURCE_ID['0584']).toBe('isolation');
    expect(EXERCISEDB_MECHANIC_BY_SOURCE_ID['0607']).toBe('isolation');
  });
});

describe('requiredItemsFor with the exercisedb source', () => {
  it('consults the curated map for exercisedb rows', () => {
    expect(requiredItemsFor(EXERCISEDB_SOURCE, '0577', ['machine'])).toEqual([
      'chest-press-machine',
    ]);
    expect(requiredItemsFor(EXERCISEDB_SOURCE, '0584', ['machine'])).toEqual([
      'lateral-raise-machine',
    ]);
    expect(requiredItemsFor(' ExerciseDB ', '0743', ['machine'])).toEqual([
      'hack-squat',
    ]);
  });

  it('falls back to the generic machine default for uncurated rows', () => {
    // lever deadlift is deliberately generic.
    const generic = requiredItemsFor(EXERCISEDB_SOURCE, '0578', ['machine']);
    expect(generic).toContain('leg-press');
    expect(generic).toContain('smith-machine');
  });

  it('leaves free-exercise-db and unknown sources unchanged', () => {
    expect(
      requiredItemsFor('free-exercise-db', 'Smith_Machine_Squat', ['machine'])
    ).toEqual(['smith-machine']);
    // An exercisedb id means nothing under another source.
    expect(requiredItemsFor('user', '0577', ['dumbbell'])).toEqual([]);
  });
});
