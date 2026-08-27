import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_ICON_CATEGORY_FALLBACKS,
  EQUIPMENT_ITEMS,
  EQUIPMENT_ITEM_CATEGORIES,
  EQUIPMENT_ITEM_ICONS,
  EQUIPMENT_ITEM_SLUGS,
  equipmentIconFor,
} from '@workspace/shared';

/**
 * The equipment icon set (`shared/src/constants/equipmentIcons.ts`), tested
 * from here because `shared/` has no test runner.
 *
 * The markup is rendered raw on web (`dangerouslySetInnerHTML`) and parsed by
 * react-native-svg on mobile, so this suite is the safety net: every string
 * must be a self-contained, well-formed, external-reference-free `<svg>` in
 * the shared 48×48 stroke style. The bespoke-gap test pins which slugs still
 * ride their category fallback, so icon coverage can only change on purpose.
 */

const allIcons: Array<[name: string, svg: string]> = [
  ...Object.entries(EQUIPMENT_ICON_CATEGORY_FALLBACKS),
  ...(Object.entries(EQUIPMENT_ITEM_ICONS) as Array<[string, string]>),
];

// Enough of an XML check for markup we author ourselves: every non-void tag
// closes, in order, and nothing dangles after the root closes.
function assertBalanced(name: string, svg: string): void {
  const tags = svg.match(/<[^>]+>/g) ?? [];
  expect(tags.length, `${name}: no tags parsed`).toBeGreaterThan(0);
  const stack: string[] = [];
  let closedRoot = false;
  for (const tag of tags) {
    expect(closedRoot, `${name}: content after </svg>`).toBe(false);
    if (tag.startsWith('</')) {
      const tagName = tag.slice(2, -1).trim();
      expect(stack.pop(), `${name}: mismatched ${tag}`).toBe(tagName);
      if (stack.length === 0) closedRoot = true;
    } else if (!tag.endsWith('/>')) {
      const tagName = (tag.slice(1, -1).split(/\s/)[0] ?? '').trim();
      stack.push(tagName);
    }
  }
  expect(stack, `${name}: unclosed tags`).toEqual([]);
  expect(closedRoot, `${name}: root never closed`).toBe(true);
}

describe('equipment icon markup', () => {
  it('has at least the nine category fallbacks', () => {
    expect(Object.keys(EQUIPMENT_ICON_CATEGORY_FALLBACKS).sort()).toEqual(
      [...EQUIPMENT_ITEM_CATEGORIES].sort()
    );
  });

  it('keys bespoke icons only by defined slugs', () => {
    const known = new Set<string>(EQUIPMENT_ITEM_SLUGS);
    for (const slug of Object.keys(EQUIPMENT_ITEM_ICONS)) {
      expect(known.has(slug), `${slug} is not a defined item`).toBe(true);
    }
  });

  it.each(allIcons)('%s is a well-formed inline svg', (name, svg) => {
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    assertBalanced(name, svg);
  });

  it.each(allIcons)('%s keeps the shared 48×48 stroke style', (name, svg) => {
    expect(svg).toContain('viewBox="0 0 48 48"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it.each(allIcons)('%s is inert and self-contained', (name, svg) => {
    // Rendered via dangerouslySetInnerHTML on web: nothing executable and no
    // external fetches may ride along, and hard-coded colors would break
    // theming on one platform or the other.
    // The xmlns namespace URI is the one legitimate "http" in the markup.
    const lower = svg
      .replace('xmlns="http://www.w3.org/2000/svg"', '')
      .toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('javascript:');
    expect(lower).not.toMatch(/\son[a-z]+=/);
    expect(lower).not.toContain('http:');
    expect(lower).not.toContain('https:');
    expect(lower).not.toContain('xlink:href');
    expect(lower).not.toContain('<image');
    expect(lower).not.toContain('<foreignobject');
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it.each(allIcons)('%s stays inline-sized (≤1KB)', (name, svg) => {
    expect(svg.length).toBeLessThanOrEqual(1024);
  });
});

describe('equipmentIconFor', () => {
  it('returns an icon for every defined slug', () => {
    for (const slug of EQUIPMENT_ITEM_SLUGS) {
      const svg = equipmentIconFor(slug);
      expect(svg.startsWith('<svg '), `${slug} has no icon`).toBe(true);
    }
  });

  it('prefers a bespoke icon and falls back by category', () => {
    for (const item of EQUIPMENT_ITEMS) {
      const bespoke = EQUIPMENT_ITEM_ICONS[item.slug];
      expect(equipmentIconFor(item.slug)).toBe(
        bespoke ?? EQUIPMENT_ICON_CATEGORY_FALLBACKS[item.category]
      );
    }
  });

  it('pins which slugs still ride their category fallback', () => {
    // The bespoke drawing backlog, explicit. Shrink this list as icons land;
    // it reaches [] when every item has its own drawing.
    const missing = EQUIPMENT_ITEM_SLUGS.filter(
      (slug) => EQUIPMENT_ITEM_ICONS[slug] === undefined
    );
    expect(missing).toEqual([...EQUIPMENT_ITEM_SLUGS]);
  });
});
