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
 * so the icons theme correctly on both platforms for free, rounded caps.
 * `width`/`height` are `1em` so an inline web icon scales with font-size;
 * mobile's `SvgXml` overrides them with explicit props.
 *
 * Shipped as code, not assets, so there is no asset pipeline, no metro
 * transformer, and no per-platform sync: web renders the markup inline
 * (`EquipmentIcon`), mobile through `SvgXml` from react-native-svg.
 *
 * ## Drawn for 16px, because that is where they ship
 *
 * Both call sites render these at 16 CSS pixels — mobile passes
 * `width={16} height={16}` to `SvgXml` in `GymProfilesScreen`, and web sets
 * `text-base` on a `1em` icon in `GymProfilesManager`. A 48-unit drawing at
 * 16px is scaled by 1/3, so the rules below are what keep a drawing from
 * turning into a grey smudge at the only size a user ever sees:
 *
 * - **Stroke 3.5**, not 2.5. At 1/3 scale that lands at ~1.2 device px, over
 *   the 1px floor; 2.5 lands at 0.83px and renders as a half-lit blur.
 * - **Keep 6 units of clear space between parallel strokes.** Below that a
 *   3.5 stroke closes the gap and two lines read as one thick one.
 * - **Five or so strokes per icon.** Interior detail is what collapses first;
 *   a plate's hole, a wheel's spokes and a rope's ripples all need amplitude,
 *   not count.
 * - **Silhouette carries the meaning.** Two icons that differ only in a small
 *   interior mark are the same icon at 16px, so distinguish by outline — a
 *   ring vs a disc, a tall Y vs a wide H, a slab vs an upright.
 * - Direction of force is drawn as an **arrow** where a machine has no other
 *   legible silhouette (chest press →, shoulder press ↑, triceps ↓); this is
 *   the only reason an arrow appears in the set.
 *
 * Every item renders SOMETHING today: `equipmentIconFor` falls back to the
 * item's category icon until a bespoke icon lands. The gap list is pinned in
 * `SparkyFitnessServer/tests/equipmentIcons.test.ts` so it is visible, not
 * silent.
 */
function icon(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
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
    '<path d="M16 24h16"/><rect x="8" y="14" width="8" height="20" rx="4"/><rect x="32" y="14" width="8" height="20" rx="4"/>',
  ),
  // A flat bench in side view.
  "benches & racks": icon(
    '<rect x="6" y="17" width="36" height="9" rx="4"/><path d="M13 26v12M35 26v12"/>',
  ),
  // A pull-up bar between two uprights.
  "bodyweight stations": icon(
    '<path d="M9 42V9M39 42V9"/><path d="M9 14h30"/>',
  ),
  // A pulley with a cable running down to a straight bar handle.
  cables: icon(
    '<circle cx="24" cy="12" r="6"/><path d="M24 18v15"/><path d="M15 37h18"/>',
  ),
  // A selectorized stack beside a seat: the generic "a machine".
  machines: icon(
    '<rect x="27" y="9" width="14" height="28" rx="3"/><path d="M27 23h14"/><path d="M7 37V22h10v15"/><path d="M7 22l8-8"/>',
  ),
  // A band loop.
  "bands & suspension": icon(
    '<path d="M7 24c0-8 8-13 17-13s17 5 17 13-8 13-17 13S7 32 7 24z"/>',
  ),
  // A tire: ring, hub, four tread bars.
  "conditioning & strongman": icon(
    '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="7"/><path d="M24 10v5M24 33v5M10 24h5M33 24h5"/>',
  ),
  // A ball balanced on a rocker board.
  "balance & recovery": icon(
    '<circle cx="24" cy="18" r="10"/><path d="M7 33c6 4 28 4 34 0"/>',
  ),
  // A heartbeat trace: cardio as a class, not one machine.
  cardio: icon('<path d="M4 26h9l5-13 8 24 5-14 3 3h10"/>'),
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
  // Short bar, wide bells close in: the dumbbell proportion.
  dumbbells: icon(
    '<path d="M17 24h14"/><rect x="7" y="15" width="10" height="18" rx="5"/><rect x="31" y="15" width="10" height="18" rx="5"/>',
  ),
  // Long bar, tall narrow plates far apart: the barbell proportion.
  barbell: icon(
    '<path d="M5 24h38"/><rect x="10" y="10" width="8" height="28" rx="4"/><rect x="30" y="10" width="8" height="28" rx="4"/>',
  ),
  // A short pre-loaded bar sitting in its rack.
  "fixed-barbells": icon(
    '<path d="M6 14h36M6 34h36"/><rect x="12" y="8" width="7" height="12" rx="3"/><rect x="29" y="8" width="7" height="12" rx="3"/><rect x="12" y="28" width="7" height="12" rx="3"/><rect x="29" y="28" width="7" height="12" rx="3"/>',
  ),
  "ez-curl-bar": icon(
    '<path d="M8 24h4l6-7 6 14 6-14 6 7h4"/><rect x="2" y="16" width="7" height="16" rx="3"/><rect x="39" y="16" width="7" height="16" rx="3"/>',
  ),
  "trap-bar": icon(
    '<path d="M16 12h16l9 12-9 12H16L7 24z"/><path d="M20 19v10M28 19v10"/>',
  ),
  // Bell body with an OPEN handle above it — the hole is the whole icon.
  kettlebells: icon(
    '<path d="M18 22c-3-10 1-15 6-15s9 5 6 15"/><path d="M9 22c-4 8-2 20 15 20s19-12 15-20z"/>',
  ),
  // A ring, not a disc: the bore is what says "plate" rather than "ball".
  "weight-plates": icon(
    '<circle cx="19" cy="24" r="14"/><circle cx="19" cy="24" r="5"/><path d="M33 11a14 14 0 0 1 0 26"/>',
  ),
  "medicine-ball": icon(
    '<circle cx="24" cy="24" r="15"/><path d="M9 24h30"/><path d="M24 9c6 9 6 21 0 30"/>',
  ),
  "slam-ball": icon(
    '<circle cx="24" cy="29" r="12"/><path d="M9 10l5 6M24 5v8M39 10l-5 6"/>',
  ),
  sandbag: icon(
    '<rect x="7" y="19" width="34" height="18" rx="8"/><path d="M17 19v-3c0-3 2-5 5-5h4c3 0 5 2 5 5v3"/>',
  ),
  // A garment: broad shoulders, V-neck, flat hem, two weight pockets. The
  // old drawing ended in two prongs and read as a pair of shorts.
  "weighted-vest": icon(
    '<path d="M18 9l-9 9v21h30V18l-9-9"/><path d="M18 9c2 4 3 5 6 5s4-1 6-5"/><path d="M13 30h9M26 30h9"/>',
  ),
  // A cuff wrapped around a limb. On its own the band is just a capsule, so
  // the limb it clamps is what names it.
  "ankle-wrist-weights": icon(
    '<rect x="5" y="17" width="38" height="16" rx="8"/><rect x="18" y="19" width="12" height="12" rx="2"/><path d="M13 25h5M30 25h5"/>',
  ),
  // ---- benches & racks ----
  "flat-bench": icon(
    '<rect x="6" y="17" width="36" height="9" rx="4"/><path d="M12 26v12M36 26v12M7 38h11M30 38h11"/>',
  ),
  "adjustable-bench": icon(
    '<rect x="4" y="23" width="20" height="8" rx="4"/><path d="M25 21L36 8l6 6-11 13z"/><path d="M11 31v8M6 39h11"/>',
  ),
  "decline-bench": icon(
    '<path d="M6 31L30 17l4 7L10 38z"/><path d="M12 38v6M31 24l5 9"/><path d="M32 12l8 6"/>',
  ),
  "squat-rack": icon(
    '<path d="M11 6v36M37 6v36M6 42h11M31 42h11"/><path d="M4 17h40"/>',
  ),
  "smith-machine": icon(
    '<path d="M11 5v38M37 5v38"/><path d="M11 25h26"/><circle cx="11" cy="25" r="6"/><circle cx="37" cy="25" r="6"/>',
  ),
  landmine: icon(
    '<path d="M5 42h16"/><circle cx="12" cy="37" r="5"/><path d="M16 34L32 18"/><circle cx="36" cy="14" r="7"/>',
  ),
  "preacher-bench": icon(
    '<path d="M9 43h12M15 43V28"/><path d="M10 28l17-10 6 10-17 10z"/>',
  ),
  // The horizontal Roman chair: pad flat, ankle rollers out to the side.
  "hyperextension-bench": icon(
    '<rect x="6" y="18" width="19" height="8" rx="4"/><path d="M13 26v16M7 42h13"/><path d="M30 42h13M36 31v11"/>',
  ),
  // A glute-ham developer: flat pad on a post, tall footplate at the far end.
  ghd: icon(
    '<path d="M6 42h36"/><rect x="6" y="17" width="20" height="8" rx="4"/><path d="M14 25v17"/><path d="M36 42V13"/><path d="M30 19h12"/>',
  ),
  // ---- bodyweight stations ----
  "pull-up-bar": icon(
    '<path d="M5 13h38"/><path d="M11 13V5M37 13V5"/><path d="M18 13v9M30 13v9"/>',
  ),
  "dip-station": icon(
    '<path d="M8 16h12M28 16h12"/><path d="M13 16v24M35 16v24M8 40h11M30 40h11"/>',
  ),
  // The assist pad hanging in the frame is the identity. Drawn as a closed
  // panel this read as a document or a vending machine.
  "assisted-pullup-dip": icon(
    '<path d="M9 43V9M39 43V9M9 14h30"/><path d="M24 14v11"/><rect x="15" y="25" width="18" height="9" rx="4"/>',
  ),
  "gymnastic-rings": icon(
    '<path d="M13 4v11M35 4v11"/><circle cx="13" cy="24" r="8"/><circle cx="35" cy="24" r="8"/>',
  ),
  parallettes: icon(
    '<path d="M5 20h16M9 20v12M17 20v12"/><path d="M27 20h16M31 20v12M39 20v12"/>',
  ),
  "plyo-box": icon(
    '<path d="M8 19l16-9 16 9-16 9z"/><path d="M8 19v13l16 9 16-9V19"/><path d="M24 28v13"/>',
  ),
  "climbing-rope": icon(
    '<path d="M11 6h26"/><path d="M24 6c7 6-7 11 0 17s-7 11 0 17"/>',
  ),
  // ---- cables ----
  "cable-tower": icon(
    '<path d="M12 5v38M6 43h12"/><path d="M12 10h18"/><circle cx="31" cy="15" r="5"/><path d="M31 20v10"/><path d="M24 34h14"/>',
  ),
  "cable-crossover": icon(
    '<path d="M8 6v38M40 6v38"/><path d="M8 12l32 24M40 12L8 36"/>',
  ),
  // Wide bar overhead, cable, seat below. The old drawing broke into
  // disconnected fragments at 16px.
  "lat-pulldown": icon(
    '<path d="M8 10h32"/><path d="M13 10v5M35 10v5"/><path d="M24 10v14"/><rect x="12" y="30" width="22" height="8" rx="4"/><path d="M17 38v5M29 38v5"/>',
  ),
  // Seat, cable, footplate: a row is pulled toward a seated body.
  "seated-row-machine": icon(
    '<path d="M5 42h38"/><rect x="7" y="31" width="14" height="7" rx="3"/><path d="M38 41V19"/><path d="M35 26H24M29 21l-5 5 5 5"/>',
  ),
  // ---- machines ----
  // Seat plus the direction of force. Chest press pushes forward.
  "chest-press-machine": icon(
    '<path d="M7 42h24M13 42V26h10"/><path d="M23 26h13"/><path d="M30 20l7 6-7 6"/>',
  ),
  "pec-deck": icon(
    '<path d="M24 12v30M18 42h12"/><path d="M11 11c-6 9-5 19 3 26M37 11c6 9 5 19-3 26"/>',
  ),
  // Shoulder press pushes up.
  "shoulder-press-machine": icon(
    '<path d="M7 42h24M13 42V28h10"/><path d="M23 28V13"/><path d="M17 19l6-6 6 6"/>',
  ),
  // A tall Y: arms rise away from the body. Paired with the wide H of
  // `hip-abductor-adductor`, which used to be the same drawing.
  "lateral-raise-machine": icon(
    '<path d="M24 43V27M17 43h14"/><path d="M24 27L11 18M24 27l13-9"/><path d="M7 22V12M41 22V12"/>',
  ),
  // Chest-supported row: pad on a post, handle out front.
  "row-machine": icon(
    '<path d="M6 42h34"/><path d="M12 42V30h10"/><rect x="27" y="13" width="10" height="23" rx="5"/><path d="M22 22h5"/>',
  ),
  // Weights hanging at each side and a double chevron: shoulders go up.
  "shrug-machine": icon(
    '<path d="M9 26h30"/><rect x="5" y="26" width="9" height="15" rx="4"/><rect x="34" y="26" width="9" height="15" rx="4"/><path d="M24 21V6M18 12l6-6 6 6"/>',
  ),
  // Preacher pad plus a selectorized stack: the machine, not the bench.
  "arm-curl-machine": icon(
    '<path d="M7 42h18M14 42V29"/><path d="M9 29l17-10 5 8-17 10z"/><path d="M32 33h7M39 27v12"/>',
  ),
  // Triceps pushes down.
  "triceps-machine": icon(
    '<path d="M7 42h24M13 42V26h10"/><path d="M23 14v14"/><path d="M17 22l6 6 6-6"/>',
  ),
  // Seat, tall back pad, and the arc the torso curls through.
  "ab-crunch-machine": icon(
    '<path d="M7 42h26M13 42V25h10"/><path d="M23 25V13"/><path d="M29 13c6 6 6 15 0 20"/>',
  ),
  "torso-rotation-machine": icon(
    '<circle cx="24" cy="32" r="11"/><path d="M24 32V22"/><path d="M11 15a17 17 0 0 1 26 0"/><path d="M31 9l6 6-6 5"/>',
  ),
  // The 45-degree hyper: angled pad on a post, ankle rollers low and forward.
  // `hyperextension-bench` is the flat Roman chair, a different frame.
  "back-extension-machine": icon(
    '<path d="M12 42h30M35 42V30"/><path d="M37 30L21 19l-5 7 16 11z"/><path d="M6 41h11M11 35v7"/>',
  ),
  // Seat low-left, rail, and a big footplate crossing it.
  "leg-press": icon(
    '<path d="M4 42h40"/><path d="M9 42V29h9"/><path d="M17 33l14-16"/><path d="M25 9L40 22"/>',
  ),
  // Standing: a solid foot platform and a shoulder pad, not a seat.
  "hack-squat": icon(
    '<path d="M4 42h40"/><rect x="7" y="32" width="20" height="7" rx="3"/><path d="M18 32L33 12"/><path d="M27 8l9 7"/>',
  ),
  // Seated, roller swings up and forward.
  "leg-extension-machine": icon(
    '<path d="M6 42h30M13 42V27h10"/><path d="M23 31l12-9"/><path d="M31 17l8 6"/>',
  ),
  // Prone: flat bench, roller hangs down behind.
  "leg-curl-machine": icon(
    '<rect x="5" y="17" width="26" height="8" rx="4"/><path d="M11 25v17M25 25v17"/><path d="M31 27l7 7"/><path d="M34 39l8-8"/>',
  ),
  "calf-machine": icon(
    '<path d="M11 7v35M37 7v35"/><path d="M11 14h26"/><rect x="15" y="31" width="18" height="8" rx="4"/>',
  ),
  // A wide H: seat between two pads that spread outward. Deliberately the
  // opposite silhouette to the tall Y of `lateral-raise-machine`.
  "hip-abductor-adductor": icon(
    '<rect x="18" y="16" width="12" height="16" rx="4"/><path d="M18 24H9M30 24h9"/><path d="M9 14v20M39 14v20"/>',
  ),
  // Hip thrust: a low pad with a lap bar over it.
  "glute-machine": icon(
    '<rect x="5" y="28" width="21" height="8" rx="4"/><path d="M11 36v6"/><path d="M39 42V16"/><path d="M19 20h20"/>',
  ),
  // Pad high on a post, legs swing down and behind.
  "reverse-hyper": icon(
    '<rect x="6" y="12" width="24" height="8" rx="4"/><path d="M12 20v22M6 42h13"/><path d="M34 20v15"/><path d="M28 39h12"/>',
  ),
  // ---- bands & suspension ----
  "resistance-bands": icon(
    '<path d="M11 33C5 20 14 8 24 8s19 12 13 25"/><rect x="6" y="33" width="9" height="11" rx="4"/><rect x="33" y="33" width="9" height="11" rx="4"/>',
  ),
  // A long loop hung over a bar — the bar is what separates it from the flat
  // mini bands below, which as bare loops were the same drawing.
  "loop-bands": icon(
    '<path d="M6 10h36"/><ellipse cx="24" cy="26" rx="10" ry="17"/>',
  ),
  // A set of two flat bands.
  "mini-bands": icon(
    '<rect x="8" y="13" width="32" height="10" rx="5"/><rect x="8" y="27" width="32" height="10" rx="5"/>',
  ),
  "suspension-trainer": icon(
    '<path d="M24 4v6"/><path d="M24 10L13 29M24 10l11 19"/><path d="M7 29h12M29 29h12"/>',
  ),
  // Two ropes, two big waves each. Finer ripples turned to grey hash.
  "battle-ropes": icon(
    '<path d="M5 17c6-9 13 9 19 0s13 9 19 0"/><path d="M5 33c6-9 13 9 19 0s13 9 19 0"/>',
  ),
  // ---- conditioning & strongman ----
  sled: icon(
    '<path d="M6 41c2 2 5 3 8 3h22"/><path d="M10 41V28h16v13"/><path d="M24 30L38 16"/><path d="M33 12l6 6"/>',
  ),
  tire: icon(
    '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="7"/><path d="M24 10v5M24 33v5M10 24h5M33 24h5"/>',
  ),
  sledgehammer: icon(
    '<path d="M10 42L30 18"/><path d="M24 8l12 10-7 8-12-10z"/>',
  ),
  // One handle, drawn big. Two of them side by side were 7px of mush each.
  "farmers-handles": icon(
    '<path d="M6 30h36"/><path d="M12 30v10M36 30v10"/><path d="M18 13h12M24 13v17"/>',
  ),
  yoke: icon(
    '<path d="M11 8v32M37 8v32M6 40h10M32 40h10"/><path d="M11 15h26"/><rect x="18" y="9" width="12" height="9" rx="2"/>',
  ),
  "atlas-stones": icon(
    '<circle cx="19" cy="27" r="13"/><circle cx="38" cy="35" r="7"/>',
  ),
  // A strongman log, the stand-in for the miscellaneous implements: the two
  // handle holes are what keep it from reading as a plain capsule.
  "strongman-misc": icon(
    '<rect x="5" y="16" width="38" height="17" rx="8"/><circle cx="17" cy="24" r="4"/><circle cx="31" cy="24" r="4"/>',
  ),
  chains: icon(
    '<ellipse cx="16" cy="14" rx="6" ry="9"/><ellipse cx="24" cy="24" rx="9" ry="6"/><ellipse cx="32" cy="34" rx="6" ry="9"/>',
  ),
  "jump-rope": icon(
    '<path d="M10 30c-2-17 30-17 28 0"/><rect x="6" y="30" width="8" height="13" rx="4"/><rect x="34" y="30" width="8" height="13" rx="4"/>',
  ),
  "agility-ladder": icon(
    '<path d="M15 5v38M33 5v38"/><path d="M15 14h18M15 24h18M15 34h18"/>',
  ),
  "heavy-bag": icon(
    '<path d="M24 4v4"/><path d="M16 14l8-6 8 6"/><rect x="14" y="13" width="20" height="28" rx="8"/>',
  ),
  // ---- balance & recovery ----
  "stability-ball": icon(
    '<circle cx="24" cy="22" r="15"/><path d="M9 42h30"/>',
  ),
  bosu: icon('<path d="M9 30c0-9 7-16 15-16s15 7 15 16"/><path d="M5 30h38"/>'),
  "foam-roller": icon(
    '<ellipse cx="13" cy="24" rx="6" ry="11"/><path d="M13 13h24M13 35h24"/><path d="M37 13a6 11 0 0 1 0 22"/>',
  ),
  // Wheel plus the axle handles poking out either side; the hub dot was a
  // single pixel and only made it look like a plate.
  "ab-wheel": icon(
    '<circle cx="24" cy="27" r="11"/><path d="M4 27h9M35 27h9"/>',
  ),
  "balance-board": icon(
    '<path d="M5 30L43 20"/><circle cx="24" cy="35" r="8"/>',
  ),
  // ---- cardio ----
  treadmill: icon(
    '<rect x="3" y="34" width="30" height="8" rx="4"/><path d="M33 38L41 12"/><path d="M36 12h9"/>',
  ),
  "stationary-bike": icon(
    '<path d="M5 42h38"/><circle cx="14" cy="33" r="8"/><path d="M20 27L32 12M25 12h8"/><path d="M32 12l4 9h6"/>',
  ),
  elliptical: icon(
    '<path d="M5 42h38"/><circle cx="13" cy="35" r="7"/><path d="M18 30L36 10M36 10V5"/><path d="M22 39h12"/>',
  ),
  // Flywheel, rail, seat.
  rower: icon(
    '<circle cx="12" cy="25" r="9"/><path d="M8 36h34"/><rect x="22" y="29" width="11" height="7" rx="3"/>',
  ),
  "stair-climber": icon('<path d="M5 42h10V32h10V22h10V12h8"/>'),
  // Two spokes, not eight: the fan wheel filled in solid at ship size.
  "air-bike": icon(
    '<circle cx="16" cy="29" r="11"/><path d="M16 18v22M5 29h22"/><path d="M27 27l8-14M35 13h-7"/>',
  ),
  // Console box with two hanging handles, so it is not the same Λ-with-feet
  // as `suspension-trainer`.
  "ski-erg": icon(
    '<path d="M10 42V7h28"/><path d="M20 7v15M34 7v15"/><path d="M16 23h8M30 23h8"/>',
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
