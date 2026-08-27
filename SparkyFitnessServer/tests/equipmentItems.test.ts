import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT,
  EQUIPMENT_ITEMS,
  EQUIPMENT_ITEM_CATEGORIES,
  EQUIPMENT_ITEM_SLUGS,
  EXERCISE_APPARATUS,
  GYM_TEMPLATES,
  GYM_TEMPLATE_SLUGS,
  ITEM_REQUIREMENTS_BY_SOURCE_ID,
  areItemsAvailable,
  deriveApparatusFromItems,
  deriveEquipmentFromItems,
  expandCoarseEquipment,
  isKnownEquipmentItem,
  requiredItemsFor,
} from '@workspace/shared';
import { FREE_EXERCISE_DB_EQUIPMENT } from './fixtures/freeExerciseDbEquipment.js';

/**
 * The granular equipment vocabulary and its classification overlay
 * (`shared/src/constants/equipmentItems.ts`), tested from here because
 * `shared/` has no test runner.
 *
 * The overlay is only correct relative to the catalog it classifies, so the
 * pinned snapshot fixture is the other half of every structural assertion:
 * a map key that names no real row would silently gate nothing.
 */

const SOURCE = 'free-exercise-db';

describe('equipment item vocabulary', () => {
  it('has unique kebab-case slugs', () => {
    const slugs = EQUIPMENT_ITEMS.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('is the 79-item catalog the blueprint tables enumerate', () => {
    // The blueprint's own totals line says 73, but its Part I tables list 79
    // rows and the tables are authoritative. Pinned so the vocabulary cannot
    // shrink (or grow) without this suite noticing.
    expect(EQUIPMENT_ITEMS.length).toBe(79);
    expect(EQUIPMENT_ITEM_SLUGS.length).toBe(79);
  });

  it('derives only canonical equipment and apparatus values', () => {
    const equipment = new Set<string>(EQUIPMENT);
    const apparatus = new Set<string>(EXERCISE_APPARATUS);
    for (const item of EQUIPMENT_ITEMS) {
      for (const value of item.derives) {
        expect(equipment.has(value)).toBe(true);
      }
      for (const value of item.derivesApparatus) {
        expect(apparatus.has(value)).toBe(true);
      }
      expect(EQUIPMENT_ITEM_CATEGORIES).toContain(item.category);
    }
  });

  it('gives every item a consequence: coarse derivation or apparatus', () => {
    // A dead checkbox — an item deriving nothing at all — would let a user
    // select something that changes no behavior anywhere.
    for (const item of EQUIPMENT_ITEMS) {
      expect(
        item.derives.length + item.derivesApparatus.length,
        `${item.slug} derives nothing`
      ).toBeGreaterThan(0);
    }
  });
});

describe('ITEM_REQUIREMENTS_BY_SOURCE_ID', () => {
  it('keys only real rows of the pinned catalog', () => {
    for (const key of Object.keys(ITEM_REQUIREMENTS_BY_SOURCE_ID)) {
      expect(
        Object.prototype.hasOwnProperty.call(FREE_EXERCISE_DB_EQUIPMENT, key),
        `${key} is not a catalog row`
      ).toBe(true);
    }
  });

  it('maps only defined item slugs', () => {
    for (const [key, slugs] of Object.entries(ITEM_REQUIREMENTS_BY_SOURCE_ID)) {
      for (const slug of slugs) {
        expect(isKnownEquipmentItem(slug), `${key} -> ${slug}`).toBe(true);
      }
    }
  });

  it('classifies every row of the machine bucket', () => {
    // The machine bucket was analyzed row by row: 19 Smith, 9 cardio, the
    // selectorized/plate-loaded lineup, and 2 hand-mapped no-requirement
    // oddities. A machine row missing here would silently fall back to the
    // generic any-machine default.
    const machineRows = Object.entries(FREE_EXERCISE_DB_EQUIPMENT)
      .filter(([, equipment]) => equipment === 'machine')
      .map(([id]) => id);
    expect(machineRows.length).toBe(67);
    for (const id of machineRows) {
      expect(
        ITEM_REQUIREMENTS_BY_SOURCE_ID[id],
        `machine row ${id} has no curated entry`
      ).toBeDefined();
    }
  });

  it('pins the curated gating counts per item', () => {
    const counts = new Map<string, number>();
    for (const slugs of Object.values(ITEM_REQUIREMENTS_BY_SOURCE_ID)) {
      for (const slug of slugs) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    // The final counts fixed when the curated map was written (2026-08-26).
    // If one of these drops, rows silently left the overlay.
    expect(counts.get('smith-machine')).toBe(19);
    expect(counts.get('treadmill')).toBe(3);
    expect(counts.get('stationary-bike')).toBe(2);
    expect(counts.get('stair-climber')).toBe(2);
    expect(counts.get('lat-pulldown')).toBe(9);
    expect(counts.get('cable-crossover')).toBe(6);
    expect(counts.get('seated-row-machine')).toBe(5);
    expect(counts.get('leg-press')).toBe(3);
    expect(counts.get('hack-squat')).toBe(3);
    expect(counts.get('sled')).toBe(10);
    expect(counts.get('plyo-box')).toBe(15);
    expect(counts.get('pull-up-bar')).toBe(10);
    expect(counts.get('dip-station')).toBe(3);
    expect(counts.get('gymnastic-rings')).toBe(3);
    expect(counts.get('suspension-trainer')).toBe(6);
    expect(counts.get('strongman-misc')).toBe(8);
    expect(counts.get('atlas-stones')).toBe(2);
    expect(counts.get('ghd')).toBe(2);
    expect(counts.get('weight-plates')).toBe(9);
    // And the map as a whole cannot silently shrink.
    expect(Object.keys(ITEM_REQUIREMENTS_BY_SOURCE_ID).length).toBe(177);
  });

  it('keeps every mapped row inside a bucket its items can reach', () => {
    // Each curated row's coarse bucket must be derivable from at least one of
    // the items that satisfy it (or be free: body only / NULL). Otherwise a
    // profile stating exactly the required item would pass the items test and
    // still lose the row to the coarse subset test — an unsatisfiable rule.
    // Weighted Bench Dip is the one deliberate cross-layer AND: an `other`
    // row whose item requirement is a bench, so it needs any other-deriving
    // item (for the coarse layer) *plus* a bench (for the items layer). A
    // strongman yard without a bench keeps it out; a sled garage with one
    // gets it. The two band rows compose the same way: bands plus any
    // other-deriving item.
    const crossLayerAnd = new Set([
      'Weighted_Bench_Dip',
      'Seated_Band_Hamstring_Curl',
      'Weighted_Sit-Ups_-_With_Bands',
    ]);
    for (const [key, slugs] of Object.entries(ITEM_REQUIREMENTS_BY_SOURCE_ID)) {
      const bucket = FREE_EXERCISE_DB_EQUIPMENT[key];
      if (bucket === null || bucket === 'body only') continue;
      if (slugs.length === 0) continue;
      if (crossLayerAnd.has(key)) continue;
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

describe('requiredItemsFor', () => {
  it('returns the curated entry for a mapped row', () => {
    expect(
      requiredItemsFor(SOURCE, 'Smith_Machine_Squat', ['machine'])
    ).toEqual(['smith-machine']);
    expect(
      requiredItemsFor(SOURCE, 'Wide-Grip_Lat_Pulldown', ['cable'])
    ).toEqual(['lat-pulldown', 'cable-tower']);
    expect(requiredItemsFor(SOURCE, 'Sled_Push', ['other'])).toEqual(['sled']);
  });

  it('honours an explicit no-requirement entry over the generic default', () => {
    // Chair Squat is a machine-bucket row that needs a chair, not a machine.
    expect(requiredItemsFor(SOURCE, 'Chair_Squat', ['machine'])).toEqual([]);
    expect(requiredItemsFor(SOURCE, 'Lunge_Sprint', ['machine'])).toEqual([]);
  });

  it('defaults a generic cable row to any single pulley station', () => {
    expect(requiredItemsFor(SOURCE, 'Triceps_Pushdown', ['cable'])).toEqual([
      'cable-tower',
      'cable-crossover',
    ]);
  });

  it('defaults a generic machine row to any machine-category presence', () => {
    const anyMachine = requiredItemsFor(null, null, ['machine']);
    expect(anyMachine).toContain('leg-press');
    expect(anyMachine).toContain('smith-machine');
    expect(anyMachine).toContain('treadmill');
    expect(anyMachine).not.toContain('cable-tower');
    expect(anyMachine).not.toContain('dumbbells');
  });

  it('applies the generic defaults to user-created rows too', () => {
    expect(requiredItemsFor('user', null, ['cable'])).toEqual([
      'cable-tower',
      'cable-crossover',
    ]);
    expect(
      requiredItemsFor('user', 'Smith_Machine_Squat', ['barbell'])
    ).toEqual([]);
  });

  it('requires nothing for rows outside the generic buckets', () => {
    expect(requiredItemsFor(SOURCE, 'Barbell_Squat', ['barbell'])).toEqual([]);
    expect(requiredItemsFor(SOURCE, null, ['dumbbell'])).toEqual([]);
  });

  it('is immune to the prototype-key trap', () => {
    expect(requiredItemsFor(SOURCE, 'constructor', ['machine'])).toEqual(
      requiredItemsFor(SOURCE, 'definitely-not-a-row', ['machine'])
    );
  });
});

describe('areItemsAvailable', () => {
  it('passes an empty requirement everywhere', () => {
    expect(areItemsAvailable([], [])).toBe(true);
  });

  it('is any-of, normalized', () => {
    expect(
      areItemsAvailable(['lat-pulldown', 'cable-tower'], ['cable-tower'])
    ).toBe(true);
    expect(areItemsAvailable(['smith-machine'], [' Smith-Machine '])).toBe(
      true
    );
    expect(areItemsAvailable(['smith-machine'], ['leg-press'])).toBe(false);
    expect(areItemsAvailable(['sled'], [])).toBe(false);
  });
});

describe('derivation', () => {
  it('derives the union of coarse buckets in canonical order', () => {
    expect(
      deriveEquipmentFromItems(['smith-machine', 'dumbbells', 'cable-tower'])
    ).toEqual(['cable', 'dumbbell', 'machine']);
    expect(deriveEquipmentFromItems([])).toEqual([]);
  });

  it('derives apparatus from benches, racks and bars', () => {
    expect(
      deriveApparatusFromItems(['flat-bench', 'squat-rack', 'pull-up-bar'])
    ).toEqual(expect.arrayContaining(['bench', 'squat rack', 'pull-up bar']));
    expect(deriveApparatusFromItems(['dumbbells'])).toEqual([]);
  });

  it('derives nothing coarse from a pure-apparatus item', () => {
    expect(deriveEquipmentFromItems(['flat-bench'])).toEqual([]);
    expect(deriveApparatusFromItems(['flat-bench'])).toEqual(['bench']);
  });
});

describe('expandCoarseEquipment', () => {
  it('expands machine to every machine-deriving item', () => {
    const expanded = expandCoarseEquipment(['machine'], null);
    expect(expanded).toContain('smith-machine');
    expect(expanded).toContain('leg-press');
    expect(expanded).toContain('treadmill');
    expect(expanded).not.toContain('cable-tower');
    expect(expanded).not.toContain('flat-bench');
  });

  it('brings apparatus items along only when the apparatus was stated', () => {
    expect(expandCoarseEquipment(['dumbbell'], ['bench'])).toEqual(
      expect.arrayContaining(['dumbbells', 'flat-bench', 'adjustable-bench'])
    );
    expect(expandCoarseEquipment(['dumbbell'], null)).toEqual(['dumbbells']);
    expect(expandCoarseEquipment(['dumbbell'], [])).toEqual(['dumbbells']);
  });

  it('round-trips: an expansion re-derives at least its input', () => {
    for (const value of EQUIPMENT) {
      const expanded = expandCoarseEquipment([value], null);
      if (expanded.length === 0) continue; // body only expands to parallettes only
      expect(deriveEquipmentFromItems(expanded)).toContain(value);
    }
  });
});

describe('gym templates', () => {
  it('defines every advertised template with only defined slugs', () => {
    expect(Object.keys(GYM_TEMPLATES).sort()).toEqual(
      [...GYM_TEMPLATE_SLUGS].sort()
    );
    for (const [name, items] of Object.entries(GYM_TEMPLATES)) {
      expect(new Set(items).size, `${name} has duplicates`).toBe(items.length);
      for (const slug of items) {
        expect(isKnownEquipmentItem(slug), `${name} -> ${slug}`).toBe(true);
      }
    }
  });

  it('gives Planet Fitness Smith machines but no Olympic barbell or rack', () => {
    const pf = GYM_TEMPLATES['planet-fitness'];
    expect(pf).toContain('smith-machine');
    expect(pf).toContain('fixed-barbells');
    expect(pf).toContain('assisted-pullup-dip');
    expect(pf).not.toContain('barbell');
    expect(pf).not.toContain('squat-rack');
    expect(pf).not.toContain('pull-up-bar');
    // The whole point of the taxonomy: a PF profile derives `machine` without
    // falsely claiming a free barbell.
    const derived = deriveEquipmentFromItems([...pf]);
    expect(derived).toContain('machine');
    expect(derived).toContain('dumbbell');
    expect(derived).toContain('barbell'); // fixed bars — capped via load_limits
  });

  it('keeps bodyweight-only an authoritative empty statement', () => {
    expect(GYM_TEMPLATES['bodyweight-only']).toEqual([]);
    expect(
      deriveEquipmentFromItems([...GYM_TEMPLATES['bodyweight-only']])
    ).toEqual([]);
  });
});
