import {
  EQUIPMENT_ITEMS,
  type EquipmentItemCategory,
  type EquipmentItemSlug,
} from "./equipmentItems.ts";

/**
 * Self-authored SVG line icons for the granular equipment vocabulary.
 *
 * One consistent set, drawn for this repo (no photos, no scraped assets in a
 * public repository): 48×48 viewBox, stroke-based, `stroke="currentColor"`
 * so the icons theme correctly on both platforms for free, 2.5px strokes,
 * rounded caps. `width`/`height` are `1em` so an inline web icon scales with
 * font-size; mobile's `SvgXml` overrides them with explicit props.
 *
 * Shipped as code, not assets, so there is no asset pipeline, no metro
 * transformer, and no per-platform sync: web renders the markup inline
 * (`EquipmentIcon`), mobile through `SvgXml` from react-native-svg.
 *
 * Every item renders SOMETHING today: `equipmentIconFor` falls back to the
 * item's category icon until a bespoke icon lands. The gap list is pinned in
 * `SparkyFitnessServer/tests/equipmentIcons.test.ts` so it is visible, not
 * silent.
 */
function icon(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/**
 * One generic icon per category: the fallback face for any item whose bespoke
 * icon has not landed yet, and the section marker where a category needs one.
 */
export const EQUIPMENT_ICON_CATEGORY_FALLBACKS: Readonly<
  Record<EquipmentItemCategory, string>
> = {
  // A dumbbell: the one silhouette everyone reads as "free weights".
  "free weights": icon(
    '<path d="M15 24h18"/><rect x="9" y="15" width="6" height="18" rx="2"/><rect x="33" y="15" width="6" height="18" rx="2"/><path d="M5 19v10M43 19v10"/>'
  ),
  // A flat bench in side view.
  "benches & racks": icon(
    '<rect x="7" y="18" width="34" height="7" rx="3"/><path d="M13 25l-3 12M35 25l3 12M10 37h8M30 37h8"/>'
  ),
  // A pull-up bar between two uprights.
  "bodyweight stations": icon(
    '<path d="M8 40V10M40 40V10M8 14h32"/><path d="M18 14v6M30 14v6"/>'
  ),
  // A pulley with a cable running down to a stirrup handle.
  cables: icon(
    '<circle cx="24" cy="12" r="5"/><path d="M24 17v13"/><path d="M18 36h12M18 36l6-6M30 36l-6-6"/>'
  ),
  // A selectorized stack beside a seat: the generic "a machine".
  machines: icon(
    '<rect x="28" y="10" width="12" height="26" rx="2"/><path d="M28 17h12M28 24h12M28 31h12"/><path d="M8 36V22h8v14"/><path d="M8 22l6-8h6"/>'
  ),
  // A band loop mid-stretch.
  "bands & suspension": icon(
    '<path d="M10 30c0-9 6-16 14-16s14 7 14 16"/><path d="M10 30c0 4 3 6 6 6s6-2 6-6M26 30c0 4 3 6 6 6s6-2 6-6"/>'
  ),
  // A tire, tread ticks and all.
  "conditioning & strongman": icon(
    '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="8"/><path d="M24 7v5M24 36v5M7 24h5M36 24h5M12 12l3.5 3.5M32.5 32.5L36 36M36 12l-3.5 3.5M15.5 32.5L12 36"/>'
  ),
  // A ball balanced on a rocker board.
  "balance & recovery": icon(
    '<circle cx="24" cy="17" r="9"/><path d="M8 32c5 4 27 4 32 0"/><path d="M14 39h20"/>'
  ),
  // A heartbeat trace: cardio as a class, not one machine.
  cardio: icon(
    '<path d="M5 26h9l4-12 8 22 5-14 3 4h9"/>'
  ),
};

/**
 * Bespoke per-item icons, one drawing per slug. The type stays `Partial` so a
 * future item can land before its drawing does — an absent entry falls back
 * to its category icon in {@link equipmentIconFor}, and the pinned test names
 * every gap so missing art is explicit, never silent.
 */
export const EQUIPMENT_ITEM_ICONS: Readonly<
  Partial<Record<EquipmentItemSlug, string>>
> = {
  // ---- free weights ----
  dumbbells: icon(
    '<path d="M16 24h16"/><rect x="11" y="15" width="5" height="18" rx="2"/><rect x="32" y="15" width="5" height="18" rx="2"/><rect x="5" y="19" width="6" height="10" rx="2"/><rect x="37" y="19" width="6" height="10" rx="2"/>'
  ),
  barbell: icon(
    '<path d="M4 24h40"/><rect x="10" y="11" width="5" height="26" rx="2"/><rect x="33" y="11" width="5" height="26" rx="2"/><rect x="17" y="15" width="4" height="18" rx="1.5"/><rect x="27" y="15" width="4" height="18" rx="1.5"/>'
  ),
  // Two short pre-loaded bars resting in a rack.
  "fixed-barbells": icon(
    '<path d="M8 17h32M8 31h32"/><rect x="13" y="12" width="4" height="10" rx="1.5"/><rect x="31" y="12" width="4" height="10" rx="1.5"/><rect x="13" y="26" width="4" height="10" rx="1.5"/><rect x="31" y="26" width="4" height="10" rx="1.5"/>'
  ),
  "ez-curl-bar": icon(
    '<path d="M6 24h5l6-5 7 10 7-10 6 5h5"/><rect x="2" y="17" width="4" height="14" rx="1.5"/><rect x="42" y="17" width="4" height="14" rx="1.5"/>'
  ),
  "trap-bar": icon(
    '<path d="M16 13h16l8 11-8 11H16L8 24z"/><path d="M19 20v8M29 20v8"/><path d="M2 24h6M40 24h6"/>'
  ),
  kettlebells: icon(
    '<path d="M17 19c-4-9 2-13 7-13s11 4 7 13"/><circle cx="24" cy="30" r="12"/>'
  ),
  "weight-plates": icon(
    '<circle cx="20" cy="24" r="15"/><circle cx="20" cy="24" r="4"/><path d="M35 12a15 15 0 0 1 0 24"/>'
  ),
  "medicine-ball": icon(
    '<circle cx="24" cy="24" r="15"/><path d="M9 24h30"/><path d="M24 9c-7 9-7 21 0 30"/>'
  ),
  "slam-ball": icon(
    '<circle cx="24" cy="28" r="12"/><path d="M8 10l5 5M24 6v7M40 10l-5 5"/>'
  ),
  sandbag: icon(
    '<rect x="8" y="20" width="32" height="17" rx="7"/><path d="M17 20v-3c0-2 2-4 4-4h6c2 0 4 2 4 4v3"/><path d="M15 29h7M26 29h7"/>'
  ),
  "weighted-vest": icon(
    '<path d="M15 7l-6 7v27h12V25M33 7l6 7v27H27V25"/><path d="M15 7c2 4 5 6 9 6s7-2 9-6"/><path d="M12 31h6M30 31h6"/>'
  ),
  "ankle-wrist-weights": icon(
    '<rect x="8" y="17" width="32" height="14" rx="7"/><path d="M17 17v14M31 17v14"/>'
  ),
  // ---- benches & racks ----
  "flat-bench": icon(
    '<rect x="6" y="18" width="36" height="8" rx="3"/><path d="M12 26v11M36 26v11M7 37h10M31 37h10"/>'
  ),
  "adjustable-bench": icon(
    '<rect x="5" y="23" width="19" height="7" rx="3"/><path d="M25 22L36 10l5 5-11 11z"/><path d="M11 30v8M21 30l4 8M6 38h10M20 38h10"/>'
  ),
  "decline-bench": icon(
    '<path d="M6 33L32 20l3 7L9 40z"/><circle cx="39" cy="15" r="4"/><path d="M36 19l-2 4M13 40v4M31 31l7 12"/>'
  ),
  "squat-rack": icon(
    '<path d="M12 6v36M36 6v36M7 42h10M31 42h10"/><path d="M12 19h5M36 19h-5"/><path d="M4 17h40"/>'
  ),
  "smith-machine": icon(
    '<path d="M10 5v38M38 5v38M10 5h28M6 43h8M34 43h8"/><rect x="8" y="21" width="5" height="9" rx="1"/><rect x="35" y="21" width="5" height="9" rx="1"/><path d="M13 25h22"/>'
  ),
  landmine: icon(
    '<path d="M4 42h18"/><circle cx="13" cy="38" r="4"/><path d="M16 35L34 17"/><circle cx="37" cy="14" r="6"/>'
  ),
  "preacher-bench": icon(
    '<path d="M8 43h12M14 43V28"/><path d="M11 28l17-9 5 10-17 9z"/><path d="M33 15v-5"/>'
  ),
  "hyperextension-bench": icon(
    '<path d="M6 22l14-8 4 7-14 8z"/><path d="M14 29v13M8 42h12"/><circle cx="35" cy="31" r="3"/><circle cx="40" cy="36" r="3"/><path d="M28 42h14"/>'
  ),
  ghd: icon(
    '<path d="M6 26c4-9 16-9 20 0"/><circle cx="33" cy="21" r="3"/><circle cx="38" cy="21" r="3"/><path d="M43 13v14"/><path d="M12 30v12M36 27v15M6 42h38"/>'
  ),
  // ---- bodyweight stations ----
  "pull-up-bar": icon(
    '<path d="M6 13h36"/><path d="M10 13V6M38 13V6"/><path d="M17 13v9M31 13v9"/>'
  ),
  "dip-station": icon(
    '<path d="M9 17h11M28 17h11"/><path d="M13 17v22M35 17v22M8 39h10M30 39h10"/>'
  ),
  "assisted-pullup-dip": icon(
    '<path d="M10 43V7h28v36"/><path d="M14 13h8M26 13h8"/><rect x="17" y="26" width="14" height="7" rx="3"/><path d="M6 43h36"/>'
  ),
  "gymnastic-rings": icon(
    '<path d="M15 4v9M33 4v9"/><circle cx="15" cy="21" r="8"/><circle cx="33" cy="21" r="8"/>'
  ),
  parallettes: icon(
    '<path d="M5 21h16M8 21v11M18 21v11M4 32h8M15 32h6"/><path d="M27 21h16M30 21v11M40 21v11M26 32h8M37 32h6"/>'
  ),
  "plyo-box": icon(
    '<path d="M8 19l16-9 16 9-16 9z"/><path d="M8 19v13l16 9 16-9V19"/><path d="M24 28v13"/>'
  ),
  "climbing-rope": icon(
    '<path d="M14 5h20"/><path d="M24 5c4 5-4 9 0 14s-4 9 0 14"/><circle cx="24" cy="38" r="3"/>'
  ),
  // ---- cables ----
  "cable-tower": icon(
    '<path d="M12 4v40M7 44h10"/><path d="M12 9h16"/><circle cx="31" cy="12" r="4"/><path d="M31 16v14"/><path d="M26 33h10M31 30v3"/>'
  ),
  "cable-crossover": icon(
    '<path d="M8 5v39M40 5v39M4 44h8M36 44h8"/><circle cx="12" cy="11" r="3"/><circle cx="36" cy="11" r="3"/><path d="M14 13l20 21M34 13L14 34"/>'
  ),
  "lat-pulldown": icon(
    '<circle cx="24" cy="7" r="3"/><path d="M24 10v5"/><path d="M8 18c2-2 4-3 8-3h16c4 0 6 1 8 3"/><path d="M16 33h16M24 33v9M18 42h12"/>'
  ),
  "seated-row-machine": icon(
    '<path d="M4 40h40"/><path d="M8 40V26h4"/><path d="M12 30h14"/><path d="M26 26v8"/><path d="M34 40v-8h6"/>'
  ),
  // ---- machines ----
  "chest-press-machine": icon(
    '<path d="M10 42V20h8v22"/><path d="M10 20l-2-9h5"/><path d="M18 24h20M38 24v-6M18 32h16M34 32v-6"/>'
  ),
  "pec-deck": icon(
    '<path d="M24 12v30M20 42h8"/><path d="M10 10c-5 8-5 17 2 24M38 10c5 8 5 17-2 24"/>'
  ),
  "shoulder-press-machine": icon(
    '<path d="M19 42V28h10v14"/><path d="M19 28v-6M29 28v-6"/><path d="M10 18v-8h7M38 18v-8h-7"/>'
  ),
  "lateral-raise-machine": icon(
    '<path d="M24 42V26"/><path d="M24 26L9 17M24 26l15-9"/><circle cx="7" cy="15" r="3"/><circle cx="41" cy="15" r="3"/><path d="M18 42h12"/>'
  ),
  "row-machine": icon(
    '<rect x="18" y="12" width="7" height="12" rx="3"/><path d="M21 24v18M14 42h14"/><path d="M8 40l8-16M40 40l-8-16"/>'
  ),
  "shrug-machine": icon(
    '<path d="M8 42h32"/><path d="M12 42V30h7M36 42V30h-7"/>'
  ),
  "arm-curl-machine": icon(
    '<path d="M8 42h14M14 42V29"/><path d="M10 29l16-8"/><path d="M26 21c7 0 11 5 11 12"/><path d="M37 33h-5"/>'
  ),
  "triceps-machine": icon(
    '<path d="M10 42V24h8v18"/><path d="M18 26h10"/><path d="M28 26c6 0 9 4 9 9v7"/><path d="M33 42h8"/>'
  ),
  "ab-crunch-machine": icon(
    '<path d="M13 42V24"/><path d="M13 24c0-9 7-14 14-14 9 0 14 8 11 17"/><path d="M38 27v8M34 35h8"/><path d="M8 42h14"/>'
  ),
  "torso-rotation-machine": icon(
    '<circle cx="24" cy="30" r="11"/><path d="M24 30v-9"/><path d="M10 18A16 16 0 0 1 20 8"/><path d="M20 8h-5M20 8v5"/>'
  ),
  "back-extension-machine": icon(
    '<path d="M12 42V26h9"/><path d="M21 26l13-9"/><rect x="31" y="9" width="9" height="6" rx="3"/><path d="M8 42h12"/>'
  ),
  "leg-press": icon(
    '<path d="M4 42h40"/><path d="M6 40l12-9h9"/><path d="M14 38L34 20"/><path d="M31 15l8 9"/>'
  ),
  "hack-squat": icon(
    '<path d="M4 42h40"/><path d="M10 40L30 12"/><path d="M26 14l8 6"/><path d="M8 34h10"/>'
  ),
  "leg-extension-machine": icon(
    '<path d="M10 40V22h12v18"/><path d="M10 24l-2-8h6"/><path d="M22 32l12 7"/><circle cx="37" cy="41" r="3"/><path d="M6 40h20"/>'
  ),
  "leg-curl-machine": icon(
    '<rect x="6" y="22" width="26" height="7" rx="3"/><path d="M12 29v13M28 29v13"/><path d="M32 25c6-1 9-5 9-11"/><circle cx="41" cy="11" r="3"/>'
  ),
  "calf-machine": icon(
    '<path d="M10 8v36M38 8v36"/><path d="M10 16h8M38 16h-8"/><rect x="15" y="34" width="18" height="6" rx="2"/>'
  ),
  "hip-abductor-adductor": icon(
    '<path d="M24 42V30"/><path d="M24 30L13 17M24 30l11-13"/><circle cx="11" cy="14" r="4"/><circle cx="37" cy="14" r="4"/><path d="M17 42h14"/>'
  ),
  "glute-machine": icon(
    '<path d="M6 42h36"/><path d="M10 42V26h12"/><path d="M28 34l8-6"/><circle cx="38" cy="26" r="3"/><path d="M30 42v-8"/>'
  ),
  "reverse-hyper": icon(
    '<rect x="7" y="15" width="27" height="7" rx="3"/><path d="M31 22l7 13"/><circle cx="39" cy="38" r="3"/><path d="M12 22v20M6 42h12"/>'
  ),
  // ---- bands & suspension ----
  "resistance-bands": icon(
    '<path d="M11 34C4 22 14 8 24 8s20 14 13 26"/><rect x="7" y="34" width="7" height="10" rx="3"/><rect x="34" y="34" width="7" height="10" rx="3"/>'
  ),
  "loop-bands": icon(
    '<path d="M6 24c0-7 8-11 18-11s18 4 18 11-8 11-18 11S6 31 6 24z"/>'
  ),
  "mini-bands": icon(
    '<rect x="10" y="15" width="28" height="18" rx="9"/><rect x="15" y="20" width="18" height="8" rx="4"/>'
  ),
  "suspension-trainer": icon(
    '<path d="M24 4v5"/><path d="M24 9L13 29M24 9l11 20"/><path d="M8 29h10M30 29h10"/><path d="M13 29v5M35 29v5"/>'
  ),
  "battle-ropes": icon(
    '<path d="M5 18c4-5 8 5 12 0s8 5 12 0 8 5 12 0"/><path d="M5 30c4-5 8 5 12 0s8 5 12 0 8 5 12 0"/>'
  ),
  // ---- conditioning & strongman ----
  sled: icon(
    '<path d="M5 40c2 2 4 3 7 3h24"/><path d="M9 40V28h18v12"/><rect x="13" y="20" width="10" height="8" rx="2"/><path d="M27 30l11-13"/><circle cx="39" cy="15" r="2"/>'
  ),
  tire: icon(
    '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="9"/><path d="M24 7v6M24 35v6M7 24h6M35 24h6M12 12l4 4M32 32l4 4M36 12l-4 4M16 32l-4 4"/>'
  ),
  sledgehammer: icon(
    '<path d="M11 42L31 17"/><path d="M25 9l11 9-6 7-11-9z"/>'
  ),
  "farmers-handles": icon(
    '<path d="M5 28h16M8 28v9M18 28v9"/><path d="M10 22h6M13 22v6"/><path d="M27 28h16M30 28v9M40 28v9"/><path d="M32 22h6M35 22v6"/>'
  ),
  yoke: icon(
    '<path d="M10 6v38M38 6v38M6 44h8M34 44h8"/><path d="M10 13h28"/><rect x="19" y="13" width="10" height="5"/>'
  ),
  "atlas-stones": icon(
    '<circle cx="19" cy="27" r="13"/><circle cx="38" cy="34" r="6"/>'
  ),
  // A strongman log, the stand-in for the miscellaneous implements.
  "strongman-misc": icon(
    '<rect x="6" y="17" width="36" height="15" rx="7"/><path d="M17 22v5M31 22v5"/>'
  ),
  chains: icon(
    '<ellipse cx="15" cy="13" rx="5" ry="8"/><ellipse cx="24" cy="24" rx="8" ry="5"/><ellipse cx="33" cy="35" rx="5" ry="8"/>'
  ),
  "jump-rope": icon(
    '<path d="M10 30c-2-16 30-16 28 0"/><path d="M10 30v3M38 30v3"/><rect x="7" y="33" width="6" height="11" rx="3"/><rect x="35" y="33" width="6" height="11" rx="3"/>'
  ),
  "agility-ladder": icon(
    '<path d="M15 4v40M33 4v40"/><path d="M15 12h18M15 22h18M15 32h18"/>'
  ),
  "heavy-bag": icon(
    '<path d="M24 4v3"/><path d="M15 14l9-7 9 7"/><rect x="14" y="13" width="20" height="27" rx="7"/>'
  ),
  // ---- balance & recovery ----
  "stability-ball": icon(
    '<circle cx="24" cy="22" r="15"/><path d="M10 42h28"/>'
  ),
  bosu: icon(
    '<path d="M9 29c0-9 6-15 15-15s15 6 15 15"/><path d="M5 29h38"/>'
  ),
  "foam-roller": icon(
    '<ellipse cx="13" cy="24" rx="5" ry="10"/><path d="M13 14h24M13 34h24"/><path d="M37 14a5 10 0 0 1 0 20"/>'
  ),
  "ab-wheel": icon(
    '<circle cx="24" cy="26" r="11"/><circle cx="24" cy="26" r="2"/><path d="M4 26h9M35 26h9"/>'
  ),
  "balance-board": icon(
    '<path d="M5 31L43 21"/><circle cx="24" cy="34" r="7"/>'
  ),
  // ---- cardio ----
  treadmill: icon(
    '<rect x="3" y="35" width="31" height="6" rx="3"/><path d="M34 35L41 12"/><path d="M38 12h7"/>'
  ),
  "stationary-bike": icon(
    '<path d="M6 42h36"/><circle cx="14" cy="34" r="7"/><path d="M19 29L31 13M31 13h-7"/><path d="M31 13l5 9M33 20h8"/>'
  ),
  elliptical: icon(
    '<path d="M6 42h36"/><circle cx="13" cy="36" r="6"/><path d="M17 32L35 12M35 12V7"/><path d="M23 38l12-16"/><path d="M20 40h12"/>'
  ),
  rower: icon(
    '<path d="M6 38L42 32"/><circle cx="10" cy="26" r="7"/><path d="M10 33v5"/><rect x="24" y="30" width="7" height="5" rx="2"/><path d="M17 27h7"/>'
  ),
  "stair-climber": icon(
    '<path d="M6 42h8v-8h8v-8h8v-8h8v-8h4"/><path d="M10 30L26 10"/>'
  ),
  "air-bike": icon(
    '<circle cx="17" cy="30" r="11"/><path d="M17 19v22M6 30h22M9 22l16 16M25 22 9 38"/><path d="M28 30l8-14M36 16h-6"/>'
  ),
  "ski-erg": icon(
    '<path d="M18 4h12M24 4v12"/><path d="M24 16l-11 16M24 16l11 16"/><path d="M7 32h9M32 32h9"/>'
  ),
};

const CATEGORY_BY_SLUG: ReadonlyMap<EquipmentItemSlug, EquipmentItemCategory> =
  new Map(EQUIPMENT_ITEMS.map((item) => [item.slug, item.category]));

/**
 * The icon to render for an item: its bespoke icon when drawn, its category's
 * fallback otherwise. Total by construction — every slug has a category.
 */
export function equipmentIconFor(slug: EquipmentItemSlug): string {
  const bespoke = EQUIPMENT_ITEM_ICONS[slug];
  if (bespoke !== undefined) return bespoke;
  const category = CATEGORY_BY_SLUG.get(slug);
  // Unreachable for a valid slug; the empty string keeps the return total
  // without inventing an icon for an unknown value.
  if (category === undefined) return "";
  return EQUIPMENT_ICON_CATEGORY_FALLBACKS[category];
}
