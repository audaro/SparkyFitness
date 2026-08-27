import {
  EQUIPMENT,
  normalizeEquipmentName,
  type Equipment,
} from "./exerciseTaxonomy.ts";
import {
  APPARATUS_OVERRIDE_SOURCE,
  type ExerciseApparatus,
} from "./exerciseApparatus.ts";

/**
 * Granular equipment vocabulary — the items a real gym actually contains.
 *
 * The pinned 12-value `EQUIPMENT` enum cannot describe a real gym: `machine`
 * hides 19 Smith-machine rows and 16 distinct strength machines, `cable` hides
 * dedicated pulldown stations, and `other` is a strongman yard nobody can
 * claim one implement from. This module is the fix, and it is an **overlay**,
 * exactly like `exerciseApparatus.ts`:
 *
 * - Layer 1 (storage/search, unchanged): exercises keep their coarse
 *   `equipment`, and the `?|` catalog filters never see an item slug.
 * - Layer 2 (engine truth): {@link ITEM_REQUIREMENTS_BY_SOURCE_ID} maps a
 *   catalog row to the granular item(s) that satisfy it, any-of, keyed on
 *   `source_id` — the key the user cannot edit out from under us.
 *
 * Slugs are the stable identity: kebab-case, used as the i18n key suffix, the
 * icon key, and the stored value in `gym_equipment_profiles.equipment_items`.
 * An item is *enforced* only where the catalog can distinguish it; items the
 * catalog cannot tell apart (a slam ball from a medicine ball) are still
 * selectable — they derive their coarse bucket so they are never a dead
 * checkbox — but nothing may write an assertion against them.
 */

export const EQUIPMENT_ITEM_CATEGORIES = [
  "free weights",
  "benches & racks",
  "bodyweight stations",
  "cables",
  "machines",
  "bands & suspension",
  "conditioning & strongman",
  "balance & recovery",
  "cardio",
] as const;
export type EquipmentItemCategory = (typeof EQUIPMENT_ITEM_CATEGORIES)[number];

interface EquipmentItemDefShape {
  slug: string;
  category: EquipmentItemCategory;
  /** Coarse {@link Equipment} values this item's presence implies. */
  derives: readonly Equipment[];
  /** Apparatus this item's presence implies. */
  derivesApparatus: readonly ExerciseApparatus[];
}

/**
 * The catalog of selectable items. Order within a category is display order.
 *
 * `derives` is what makes the two-layer design safe: a profile stating items
 * has its coarse `equipment` and `apparatus` *derived* from them server-side,
 * so the `?|` search filter, the engine's coarse subset test, and every legacy
 * reader keep working unmodified.
 */
export const EQUIPMENT_ITEMS = [
  // --- free weights ---
  {
    slug: "dumbbells",
    category: "free weights",
    derives: ["dumbbell"],
    derivesApparatus: [],
  },
  {
    slug: "barbell",
    category: "free weights",
    derives: ["barbell"],
    derivesApparatus: [],
  },
  {
    slug: "fixed-barbells",
    category: "free weights",
    derives: ["barbell"],
    derivesApparatus: [],
  },
  {
    slug: "ez-curl-bar",
    category: "free weights",
    derives: ["e-z curl bar"],
    derivesApparatus: [],
  },
  {
    slug: "trap-bar",
    category: "free weights",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "kettlebells",
    category: "free weights",
    derives: ["kettlebells"],
    derivesApparatus: [],
  },
  {
    slug: "weight-plates",
    category: "free weights",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "medicine-ball",
    category: "free weights",
    derives: ["medicine ball"],
    derivesApparatus: [],
  },
  {
    slug: "slam-ball",
    category: "free weights",
    derives: ["medicine ball"],
    derivesApparatus: [],
  },
  {
    slug: "sandbag",
    category: "free weights",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "weighted-vest",
    category: "free weights",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "ankle-wrist-weights",
    category: "free weights",
    derives: ["other"],
    derivesApparatus: [],
  },
  // --- benches & racks ---
  {
    slug: "flat-bench",
    category: "benches & racks",
    derives: [],
    derivesApparatus: ["bench"],
  },
  {
    slug: "adjustable-bench",
    category: "benches & racks",
    derives: [],
    derivesApparatus: ["bench"],
  },
  {
    slug: "decline-bench",
    category: "benches & racks",
    derives: [],
    derivesApparatus: ["bench"],
  },
  {
    slug: "squat-rack",
    category: "benches & racks",
    derives: [],
    derivesApparatus: ["squat rack"],
  },
  {
    slug: "smith-machine",
    category: "benches & racks",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "landmine",
    category: "benches & racks",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "preacher-bench",
    category: "benches & racks",
    derives: [],
    derivesApparatus: ["bench"],
  },
  {
    slug: "hyperextension-bench",
    category: "benches & racks",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "ghd",
    category: "benches & racks",
    derives: ["machine"],
    derivesApparatus: [],
  },
  // --- bodyweight stations ---
  {
    slug: "pull-up-bar",
    category: "bodyweight stations",
    derives: ["other"],
    derivesApparatus: ["pull-up bar"],
  },
  {
    slug: "dip-station",
    category: "bodyweight stations",
    derives: ["other"],
    derivesApparatus: ["dip station"],
  },
  {
    slug: "assisted-pullup-dip",
    category: "bodyweight stations",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "gymnastic-rings",
    category: "bodyweight stations",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "parallettes",
    category: "bodyweight stations",
    derives: ["body only"],
    derivesApparatus: [],
  },
  {
    slug: "plyo-box",
    category: "bodyweight stations",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "climbing-rope",
    category: "bodyweight stations",
    derives: ["other"],
    derivesApparatus: [],
  },
  // --- cables ---
  {
    slug: "cable-tower",
    category: "cables",
    derives: ["cable"],
    derivesApparatus: [],
  },
  {
    slug: "cable-crossover",
    category: "cables",
    derives: ["cable"],
    derivesApparatus: [],
  },
  {
    slug: "lat-pulldown",
    category: "cables",
    derives: ["cable"],
    derivesApparatus: [],
  },
  {
    slug: "seated-row-machine",
    category: "cables",
    derives: ["cable"],
    derivesApparatus: [],
  },
  // --- machines ---
  {
    slug: "chest-press-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "pec-deck",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "shoulder-press-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "lateral-raise-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "row-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "shrug-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "arm-curl-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "triceps-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "ab-crunch-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "torso-rotation-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "back-extension-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "leg-press",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "hack-squat",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "leg-extension-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "leg-curl-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "calf-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "hip-abductor-adductor",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "glute-machine",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "reverse-hyper",
    category: "machines",
    derives: ["machine"],
    derivesApparatus: [],
  },
  // --- bands & suspension ---
  {
    slug: "resistance-bands",
    category: "bands & suspension",
    derives: ["bands"],
    derivesApparatus: [],
  },
  {
    slug: "loop-bands",
    category: "bands & suspension",
    derives: ["bands"],
    derivesApparatus: [],
  },
  {
    slug: "mini-bands",
    category: "bands & suspension",
    derives: ["bands"],
    derivesApparatus: [],
  },
  {
    slug: "suspension-trainer",
    category: "bands & suspension",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "battle-ropes",
    category: "bands & suspension",
    derives: ["other"],
    derivesApparatus: [],
  },
  // --- conditioning & strongman ---
  {
    slug: "sled",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "tire",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "sledgehammer",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "farmers-handles",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "yoke",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "atlas-stones",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "strongman-misc",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "chains",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "jump-rope",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "agility-ladder",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "heavy-bag",
    category: "conditioning & strongman",
    derives: ["other"],
    derivesApparatus: [],
  },
  // --- balance & recovery ---
  {
    slug: "stability-ball",
    category: "balance & recovery",
    derives: ["exercise ball"],
    derivesApparatus: [],
  },
  {
    slug: "bosu",
    category: "balance & recovery",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "foam-roller",
    category: "balance & recovery",
    derives: ["foam roll"],
    derivesApparatus: [],
  },
  {
    slug: "ab-wheel",
    category: "balance & recovery",
    derives: ["other"],
    derivesApparatus: [],
  },
  {
    slug: "balance-board",
    category: "balance & recovery",
    derives: ["other"],
    derivesApparatus: [],
  },
  // --- cardio ---
  {
    slug: "treadmill",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "stationary-bike",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "elliptical",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "rower",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "stair-climber",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "air-bike",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
  {
    slug: "ski-erg",
    category: "cardio",
    derives: ["machine"],
    derivesApparatus: [],
  },
] as const satisfies readonly EquipmentItemDefShape[];

export type EquipmentItemSlug = (typeof EQUIPMENT_ITEMS)[number]["slug"];

export interface EquipmentItemDef extends EquipmentItemDefShape {
  slug: EquipmentItemSlug;
}

/** Every slug, in catalog order — the Zod enum source. */
export const EQUIPMENT_ITEM_SLUGS = EQUIPMENT_ITEMS.map(
  (item) => item.slug,
) as [EquipmentItemSlug, ...EquipmentItemSlug[]];

const ITEMS_BY_SLUG: ReadonlyMap<string, EquipmentItemDef> = new Map(
  EQUIPMENT_ITEMS.map((item) => [item.slug, item]),
);

const EQUIPMENT_ITEM_SLUG_SET: ReadonlySet<string> = new Set(
  EQUIPMENT_ITEM_SLUGS,
);

/** Exact membership test for an item slug. */
export function isKnownEquipmentItem(
  value: string,
): value is EquipmentItemSlug {
  return EQUIPMENT_ITEM_SLUG_SET.has(value);
}

/**
 * The coarse equipment a set of stated items implies — the server-side
 * derivation contract's first half. Deduplicated and returned in canonical
 * {@link EQUIPMENT} order so the same selection always derives the same
 * stored array.
 */
export function deriveEquipmentFromItems(
  items: readonly EquipmentItemSlug[],
): Equipment[] {
  const derived = new Set<Equipment>();
  for (const slug of items) {
    for (const value of ITEMS_BY_SLUG.get(slug)?.derives ?? []) {
      derived.add(value);
    }
  }
  return EQUIPMENT.filter((value) => derived.has(value));
}

/** Apparatus counterpart of {@link deriveEquipmentFromItems}. */
export function deriveApparatusFromItems(
  items: readonly EquipmentItemSlug[],
): ExerciseApparatus[] {
  const derived = new Set<ExerciseApparatus>();
  for (const slug of items) {
    for (const value of ITEMS_BY_SLUG.get(slug)?.derivesApparatus ?? []) {
      derived.add(value);
    }
  }
  return [...derived];
}

/**
 * The expansion of a coarse equipment value into every item that derives it —
 * the "Upgrade to detailed equipment" starting point. Deliberately generous
 * (a legacy `machine` becomes every machine-category item): the flow labels
 * it as a starting point to prune, and over-selecting keeps every exercise
 * the coarse profile could reach reachable.
 */
export function expandCoarseEquipment(
  equipment: readonly string[],
  apparatus: readonly string[] | null,
): EquipmentItemSlug[] {
  const coarse = new Set(equipment.map(normalizeEquipmentName));
  const stated = apparatus === null ? null : new Set(apparatus);
  return EQUIPMENT_ITEMS.filter((item) => {
    if (item.derives.some((value) => coarse.has(value))) return true;
    // Apparatus-backed items (benches, racks, bars) come along only when the
    // profile stated that apparatus — expanding them from silence would turn
    // "never stated" into "stated present" on upgrade.
    return (
      stated !== null &&
      item.derivesApparatus.some((value) => stated.has(value))
    );
  }).map((item) => item.slug);
}

// ---------------------------------------------------------------------------
// Classification overlay
// ---------------------------------------------------------------------------

/**
 * free-exercise-db `source_id` -> the granular items that satisfy it, ANY-OF.
 *
 * An explicit empty array means "no subtype requirement beyond coarse
 * equipment" and exists to pin the handful of rows the generic defaults in
 * {@link requiredItemsFor} would otherwise over-claim (Chair Squat is a
 * bodyweight-with-chair oddity, not a machine movement). A row absent from
 * the map falls through to those defaults.
 *
 * Curated by hand from the 2026-08-26 per-bucket analysis of the pinned
 * catalog (`dist/exercises.json`, 873 rows); every key is verified against
 * the snapshot fixture in `SparkyFitnessServer/tests/fixtures/`. All
 * requirements are disjunctions — nothing in the catalog needs two distinct
 * items at once — so any-of is the whole semantics.
 */
export const ITEM_REQUIREMENTS_BY_SOURCE_ID: Readonly<
  Record<string, readonly EquipmentItemSlug[]>
> = {
  // --- machine bucket: Smith machine (19) ---
  Decline_Smith_Press: ["smith-machine"],
  Smith_Machine_Behind_the_Back_Shrug: ["smith-machine"],
  Smith_Machine_Bench_Press: ["smith-machine"],
  Smith_Machine_Bent_Over_Row: ["smith-machine"],
  Smith_Machine_Calf_Raise: ["smith-machine"],
  "Smith_Machine_Close-Grip_Bench_Press": ["smith-machine"],
  Smith_Machine_Decline_Press: ["smith-machine"],
  Smith_Machine_Hang_Power_Clean: ["smith-machine"],
  Smith_Machine_Hip_Raise: ["smith-machine"],
  Smith_Machine_Incline_Bench_Press: ["smith-machine"],
  Smith_Machine_Leg_Press: ["smith-machine"],
  "Smith_Machine_One-Arm_Upright_Row": ["smith-machine"],
  Smith_Machine_Overhead_Shoulder_Press: ["smith-machine"],
  Smith_Machine_Pistol_Squat: ["smith-machine"],
  Smith_Machine_Reverse_Calf_Raises: ["smith-machine"],
  Smith_Machine_Squat: ["smith-machine"],
  "Smith_Machine_Stiff-Legged_Deadlift": ["smith-machine"],
  Smith_Machine_Upright_Row: ["smith-machine"],
  "Smith_Single-Leg_Split_Squat": ["smith-machine"],
  // --- machine bucket: cardio (9) ---
  Bicycling_Stationary: ["stationary-bike"],
  Recumbent_Bike: ["stationary-bike"],
  Elliptical_Trainer: ["elliptical"],
  Jogging_Treadmill: ["treadmill"],
  Running_Treadmill: ["treadmill"],
  Walking_Treadmill: ["treadmill"],
  Rowing_Stationary: ["rower"],
  Stairmaster: ["stair-climber"],
  Step_Mill: ["stair-climber"],
  // --- machine bucket: strength machines ---
  Machine_Bench_Press: ["chest-press-machine"],
  Leverage_Chest_Press: ["chest-press-machine"],
  Leverage_Incline_Chest_Press: ["chest-press-machine"],
  Leverage_Decline_Chest_Press: ["chest-press-machine"],
  Butterfly: ["pec-deck"],
  Reverse_Machine_Flyes: ["pec-deck"],
  Leverage_Shoulder_Press: ["shoulder-press-machine"],
  Machine_Shoulder_Military_Press: ["shoulder-press-machine"],
  Leverage_High_Row: ["row-machine"],
  Leverage_Iso_Row: ["row-machine"],
  "Lying_T-Bar_Row": ["row-machine"],
  // The blueprint's hand mapping: a plate-loaded lever deadlift lives with
  // the iso-lateral row family, not with barbell deadlifts.
  Leverage_Deadlift: ["row-machine"],
  Leverage_Shrug: ["shrug-machine"],
  "Calf-Machine_Shoulder_Shrug": ["shrug-machine"],
  Machine_Bicep_Curl: ["arm-curl-machine"],
  Machine_Preacher_Curls: ["arm-curl-machine"],
  Machine_Triceps_Extension: ["triceps-machine"],
  Ab_Crunch_Machine: ["ab-crunch-machine"],
  Leg_Press: ["leg-press"],
  Narrow_Stance_Leg_Press: ["leg-press"],
  Calf_Press_On_The_Leg_Press_Machine: ["leg-press"],
  Hack_Squat: ["hack-squat"],
  Narrow_Stance_Hack_Squats: ["hack-squat"],
  Lying_Machine_Squat: ["hack-squat"],
  Leg_Extensions: ["leg-extension-machine"],
  "Single-Leg_Leg_Extension": ["leg-extension-machine"],
  Lying_Leg_Curls: ["leg-curl-machine"],
  Seated_Leg_Curl: ["leg-curl-machine"],
  Standing_Leg_Curl: ["leg-curl-machine"],
  Calf_Press: ["calf-machine"],
  Seated_Calf_Raise: ["calf-machine"],
  Standing_Calf_Raises: ["calf-machine"],
  Thigh_Abductor: ["hip-abductor-adductor"],
  Thigh_Adductor: ["hip-abductor-adductor"],
  Reverse_Hyperextension: ["reverse-hyper"],
  Glute_Ham_Raise: ["ghd"],
  Dip_Machine: ["assisted-pullup-dip"],
  // Hand-mapped to no requirement: a chair and a hallway, not a machine.
  Chair_Squat: [],
  Lunge_Sprint: [],
  // --- body only bucket: the one GHD row outside `machine` ---
  Natural_Glute_Ham_Raise: ["ghd"],
  // --- cable bucket: pulldown stations (any-of with a tower; kneeling
  //     pulldowns work at a tower's high pulley — Fitbod-consistent) ---
  "Close-Grip_Front_Lat_Pulldown": ["lat-pulldown", "cable-tower"],
  "Full_Range-Of-Motion_Lat_Pulldown": ["lat-pulldown", "cable-tower"],
  One_Arm_Lat_Pulldown: ["lat-pulldown", "cable-tower"],
  Underhand_Cable_Pulldowns: ["lat-pulldown", "cable-tower"],
  "V-Bar_Pulldown": ["lat-pulldown", "cable-tower"],
  "Wide-Grip_Lat_Pulldown": ["lat-pulldown", "cable-tower"],
  "Wide-Grip_Pulldown_Behind_The_Neck": ["lat-pulldown", "cable-tower"],
  Kneeling_High_Pulley_Row: ["lat-pulldown", "cable-tower"],
  "Kneeling_Single-Arm_High_Pulley_Row": ["lat-pulldown", "cable-tower"],
  // --- cable bucket: dual-stack crossover only ---
  Cable_Crossover: ["cable-crossover"],
  Low_Cable_Crossover: ["cable-crossover"],
  "Single-Arm_Cable_Crossover": ["cable-crossover"],
  Cable_Iron_Cross: ["cable-crossover"],
  Flat_Bench_Cable_Flyes: ["cable-crossover"],
  Incline_Cable_Flye: ["cable-crossover"],
  // --- cable bucket: seated row stations (any-of with a tower) ---
  Seated_Cable_Rows: ["seated-row-machine", "cable-tower"],
  "Seated_One-arm_Cable_Pulley_Rows": ["seated-row-machine", "cable-tower"],
  Low_Pulley_Row_To_Neck: ["seated-row-machine", "cable-tower"],
  Elevated_Cable_Rows: ["seated-row-machine", "cable-tower"],
  Shotgun_Row: ["seated-row-machine", "cable-tower"],
  // --- other bucket: free weights ---
  Trap_Bar_Deadlift: ["trap-bar"],
  Front_Plate_Raise: ["weight-plates"],
  Plate_Pinch: ["weight-plates"],
  Plate_Twist: ["weight-plates"],
  Standing_Olympic_Plate_Hand_Squeeze: ["weight-plates"],
  Reverse_Plate_Curls: ["weight-plates"],
  Lying_Face_Down_Plate_Neck_Resistance: ["weight-plates"],
  Lying_Face_Up_Plate_Neck_Resistance: ["weight-plates"],
  Svend_Press: ["weight-plates"],
  "Otis-Up": ["weight-plates"],
  Sandbag_Load: ["sandbag"],
  // --- other bucket: benches ---
  Hyperextensions_Back_Extensions: ["hyperextension-bench"],
  Weighted_Bench_Dip: ["flat-bench", "adjustable-bench"],
  // --- other bucket: pull-up bar ---
  Weighted_Pull_Ups: ["pull-up-bar"],
  "One_Arm_Chin-Up": ["pull-up-bar"],
  Mixed_Grip_Chin: ["pull-up-bar"],
  Side_To_Side_Chins: ["pull-up-bar"],
  Gironda_Sternum_Chins: ["pull-up-bar"],
  "Rocky_Pull-Ups_Pulldowns": ["pull-up-bar"],
  London_Bridges: ["pull-up-bar"],
  One_Handed_Hang: ["pull-up-bar"],
  "Band_Assisted_Pull-Up": ["pull-up-bar"],
  // A bar muscle-up and a ring muscle-up are both real.
  Muscle_Up: ["pull-up-bar", "gymnastic-rings"],
  // --- other bucket: dip station / rings ---
  Parallel_Bar_Dip: ["dip-station"],
  "Dips_-_Chest_Version": ["dip-station"],
  Knee_Hip_Raise_On_Parallel_Bars: ["dip-station"],
  Ring_Dips: ["gymnastic-rings"],
  Kipping_Muscle_Up: ["gymnastic-rings"],
  // --- other bucket: plyo boxes (a sturdy bench substitutes for the
  //     bench-edge jumps, so those are any-of) ---
  Box_Jump_Multiple_Response: ["plyo-box"],
  Box_Skip: ["plyo-box"],
  Front_Box_Jump: ["plyo-box"],
  Lateral_Box_Jump: ["plyo-box"],
  Side_to_Side_Box_Shuffle: ["plyo-box"],
  "Single-Leg_High_Box_Squat": ["plyo-box"],
  Depth_Jump_Leap: ["plyo-box"],
  Linear_Depth_Jump: ["plyo-box"],
  "Incline_Push-Up_Depth_Jump": ["plyo-box"],
  Drop_Push: ["plyo-box"],
  Quick_Leap: ["plyo-box"],
  "Single_Leg_Push-off": ["plyo-box"],
  Bench_Sprint: ["plyo-box", "flat-bench"],
  "Single-Leg_Stride_Jump": ["plyo-box", "flat-bench"],
  Stride_Jump_Crossover: ["plyo-box", "flat-bench"],
  // --- other bucket: ropes, straps, bags ---
  Rope_Climb: ["climbing-rope"],
  Battling_Ropes: ["battle-ropes"],
  Suspended_Fallout: ["suspension-trainer"],
  "Suspended_Push-Up": ["suspension-trainer"],
  Suspended_Reverse_Crunch: ["suspension-trainer"],
  Suspended_Row: ["suspension-trainer"],
  Suspended_Split_Squat: ["suspension-trainer"],
  Inverted_Row_with_Straps: ["suspension-trainer"],
  Rope_Jumping: ["jump-rope"],
  Heavy_Bag_Thrust: ["heavy-bag"],
  // --- other bucket: bands hiding outside `bands` ---
  Seated_Band_Hamstring_Curl: ["resistance-bands", "loop-bands", "mini-bands"],
  "Weighted_Sit-Ups_-_With_Bands": [
    "resistance-bands",
    "loop-bands",
    "mini-bands",
  ],
  // --- other bucket: conditioning & strongman ---
  Backward_Drag: ["sled"],
  Bear_Crawl_Sled_Drags: ["sled"],
  Forward_Drag_with_Press: ["sled"],
  Prowler_Sprint: ["sled"],
  "Sled_Drag_-_Harness": ["sled"],
  Sled_Overhead_Backward_Walk: ["sled"],
  Sled_Overhead_Triceps_Extension: ["sled"],
  Sled_Push: ["sled"],
  Sled_Reverse_Flye: ["sled"],
  Sled_Row: ["sled"],
  Tire_Flip: ["tire"],
  Sledgehammer_Swings: ["sledgehammer"],
  Farmers_Walk: ["farmers-handles"],
  Rickshaw_Carry: ["farmers-handles"],
  Rickshaw_Deadlift: ["farmers-handles"],
  Yoke_Walk: ["yoke"],
  Atlas_Stones: ["atlas-stones"],
  Atlas_Stone_Trainer: ["atlas-stones"],
  Log_Lift: ["strongman-misc"],
  Axle_Deadlift: ["strongman-misc"],
  Keg_Load: ["strongman-misc"],
  Circus_Bell: ["strongman-misc"],
  Car_Deadlift: ["strongman-misc"],
  Conans_Wheel: ["strongman-misc"],
  Power_Stairs: ["strongman-misc"],
  Crucifix: ["strongman-misc"],
  Chain_Press: ["chains"],
  Chain_Handle_Extension: ["chains"],
  // --- other bucket: agility ---
  Front_Cone_Hops_or_hurdle_hops: ["agility-ladder"],
  Lateral_Cone_Hops: ["agility-ladder"],
  "Single-Cone_Sprint_Drill": ["agility-ladder"],
  Hurdle_Hops: ["agility-ladder"],
  // --- other bucket: balance & recovery ---
  Ab_Roller: ["ab-wheel"],
  Balance_Board: ["balance-board"],
};

/**
 * A Map, not the object literal above, because the lookup key is a database
 * value: `ITEM_REQUIREMENTS_BY_SOURCE_ID["constructor"]` hands back a
 * function. Same trap `APPARATUS_LOOKUP` documents.
 */
const ITEM_REQUIREMENTS_LOOKUP: ReadonlyMap<
  string,
  readonly EquipmentItemSlug[]
> = new Map(Object.entries(ITEM_REQUIREMENTS_BY_SOURCE_ID));

/**
 * Defaults for rows the curated map does not name, in ONE place so the rule
 * cannot drift between the engine and its tests:
 *
 * - A generic `cable` row is satisfied by any single high/low pulley — a
 *   tower or a crossover stack.
 * - A generic `machine` row is satisfied by any machine-category presence: a
 *   profile that ticked only `leg-press` still plausibly stands in a room
 *   with machines, and the couple of rows this over-admits are trivia next
 *   to blocking a whole gym's machines behind an unmappable generic row.
 */
const GENERIC_CABLE_ANY_OF: readonly EquipmentItemSlug[] = [
  "cable-tower",
  "cable-crossover",
];
/**
 * The 170 `barbell`-bucket rows are free-bar movements (squats, pulls,
 * presses off a rack or the floor). `fixed-barbells` derives the coarse
 * bucket — that keeps catalog search and every legacy reader honest, and it
 * is what `load_limits.barbell` caps — but a rack of fixed bars to 60 lb
 * cannot perform them, so it does not satisfy the item gate. This is the one
 * bucket where a deriving item and the bucket's rows genuinely part ways;
 * without this default a Planet Fitness profile (fixed bars, no Olympic bar)
 * would be prescribed free-barbell squats.
 */
const GENERIC_FREE_BARBELL_ANY_OF: readonly EquipmentItemSlug[] = ["barbell"];
const GENERIC_MACHINE_ANY_OF: readonly EquipmentItemSlug[] =
  EQUIPMENT_ITEMS.filter((item) =>
    (item.derives as readonly Equipment[]).includes("machine"),
  ).map((item) => item.slug);

/**
 * The granular items that satisfy this exercise, ANY-OF; `[]` = no
 * requirement beyond coarse equipment. The single source of the
 * curated-map-plus-defaults rule described above.
 *
 * Only rows from {@link APPARATUS_OVERRIDE_SOURCE} consult the curated map —
 * its keys are that catalog's ids — but the generic-bucket defaults apply to
 * every row, because a user-created "cable fly" needs a pulley just as much
 * as the imported one does.
 */
export function requiredItemsFor(
  source: string | null | undefined,
  sourceId: string | null | undefined,
  coarseEquipment: readonly string[],
): readonly EquipmentItemSlug[] {
  if (source?.trim().toLowerCase() === APPARATUS_OVERRIDE_SOURCE && sourceId) {
    const curated = ITEM_REQUIREMENTS_LOOKUP.get(sourceId.trim());
    if (curated !== undefined) return curated;
  }
  const coarse = new Set(coarseEquipment.map(normalizeEquipmentName));
  const anyOf = new Set<EquipmentItemSlug>();
  if (coarse.has("barbell")) {
    for (const slug of GENERIC_FREE_BARBELL_ANY_OF) anyOf.add(slug);
  }
  if (coarse.has("cable")) {
    for (const slug of GENERIC_CABLE_ANY_OF) anyOf.add(slug);
  }
  if (coarse.has("machine")) {
    for (const slug of GENERIC_MACHINE_ANY_OF) anyOf.add(slug);
  }
  return [...anyOf];
}

/**
 * Whether a profile's stated items satisfy an any-of requirement. `[]`
 * requires nothing. Stated items are normalized the same way equipment is,
 * so a hand-entered `" Smith-Machine "` still matches.
 */
export function areItemsAvailable(
  required: readonly EquipmentItemSlug[],
  statedItems: readonly string[],
): boolean {
  if (required.length === 0) return true;
  const stated = new Set(statedItems.map(normalizeEquipmentName));
  return required.some((slug) => stated.has(slug));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const GYM_TEMPLATE_SLUGS = [
  "planet-fitness",
  "commercial-gym",
  "home-basics",
  "garage-crossfit",
  "hotel-gym",
  "bodyweight-only",
] as const;
export type GymTemplateSlug = (typeof GYM_TEMPLATE_SLUGS)[number];

/**
 * One-tap prefills for the item picker, all editable after. Shared so both
 * clients and the chat tool expand the same template to the same selection.
 *
 * Planet Fitness is the researched case the whole taxonomy exists for:
 * dumbbells and fixed bars but no Olympic barbell, no rack, Smith machines,
 * a full selectorized lineup, cable stations, the assisted pull-up/dip
 * machine, benches, and a large cardio floor.
 */
export const GYM_TEMPLATES: Readonly<
  Record<GymTemplateSlug, readonly EquipmentItemSlug[]>
> = {
  "planet-fitness": [
    "dumbbells",
    "fixed-barbells",
    "flat-bench",
    "adjustable-bench",
    "smith-machine",
    "assisted-pullup-dip",
    "cable-tower",
    "cable-crossover",
    "lat-pulldown",
    "seated-row-machine",
    "chest-press-machine",
    "pec-deck",
    "shoulder-press-machine",
    "lateral-raise-machine",
    "row-machine",
    "arm-curl-machine",
    "triceps-machine",
    "ab-crunch-machine",
    "torso-rotation-machine",
    "back-extension-machine",
    "leg-press",
    "leg-extension-machine",
    "leg-curl-machine",
    "calf-machine",
    "hip-abductor-adductor",
    "glute-machine",
    "stability-ball",
    "bosu",
    "foam-roller",
    "medicine-ball",
    "treadmill",
    "stationary-bike",
    "elliptical",
    "stair-climber",
    "rower",
  ],
  "commercial-gym": [
    "dumbbells",
    "barbell",
    "fixed-barbells",
    "ez-curl-bar",
    "trap-bar",
    "kettlebells",
    "weight-plates",
    "medicine-ball",
    "flat-bench",
    "adjustable-bench",
    "decline-bench",
    "squat-rack",
    "smith-machine",
    "landmine",
    "preacher-bench",
    "hyperextension-bench",
    "pull-up-bar",
    "dip-station",
    "assisted-pullup-dip",
    "plyo-box",
    "cable-tower",
    "cable-crossover",
    "lat-pulldown",
    "seated-row-machine",
    "chest-press-machine",
    "pec-deck",
    "shoulder-press-machine",
    "lateral-raise-machine",
    "row-machine",
    "shrug-machine",
    "arm-curl-machine",
    "triceps-machine",
    "ab-crunch-machine",
    "back-extension-machine",
    "leg-press",
    "hack-squat",
    "leg-extension-machine",
    "leg-curl-machine",
    "calf-machine",
    "hip-abductor-adductor",
    "glute-machine",
    "resistance-bands",
    "loop-bands",
    "suspension-trainer",
    "battle-ropes",
    "stability-ball",
    "bosu",
    "foam-roller",
    "ab-wheel",
    "treadmill",
    "stationary-bike",
    "elliptical",
    "rower",
    "stair-climber",
  ],
  "home-basics": [
    "dumbbells",
    "resistance-bands",
    "loop-bands",
    "mini-bands",
    "flat-bench",
    "stability-ball",
    "foam-roller",
    "ab-wheel",
    "jump-rope",
  ],
  "garage-crossfit": [
    "dumbbells",
    "barbell",
    "trap-bar",
    "kettlebells",
    "weight-plates",
    "medicine-ball",
    "slam-ball",
    "flat-bench",
    "squat-rack",
    "pull-up-bar",
    "dip-station",
    "gymnastic-rings",
    "plyo-box",
    "climbing-rope",
    "loop-bands",
    "battle-ropes",
    "sled",
    "jump-rope",
    "ab-wheel",
    "foam-roller",
    "rower",
    "air-bike",
  ],
  "hotel-gym": [
    "dumbbells",
    "adjustable-bench",
    "cable-tower",
    "stability-ball",
    "foam-roller",
    "treadmill",
    "stationary-bike",
    "elliptical",
  ],
  // An authoritative "nothing here": stated-but-empty items derive no
  // equipment and no apparatus, which is exactly what training with only a
  // floor means.
  "bodyweight-only": [],
};
