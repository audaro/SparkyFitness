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
 * Bespoke per-item icons. Deliberately `Partial`: an absent entry falls back
 * to its category icon in {@link equipmentIconFor}, and the pinned test names
 * every gap so the drawing backlog is explicit.
 */
export const EQUIPMENT_ITEM_ICONS: Readonly<
  Partial<Record<EquipmentItemSlug, string>>
> = {};

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
