import React from 'react';
import { equipmentIconFor, type EquipmentItemSlug } from '@workspace/shared';

interface EquipmentIconProps {
  slug: EquipmentItemSlug;
  className?: string;
}

/**
 * Inline line icon for a granular equipment item, from the shared
 * self-authored set (`@workspace/shared` equipmentIcons). Every slug renders:
 * items without a bespoke drawing fall back to their category icon.
 *
 * The markup is trusted first-party source shipped in this repo — never user
 * or network content — which is the only reason `dangerouslySetInnerHTML` is
 * acceptable here; the `<svg` guard keeps a malformed future entry from
 * injecting anything else. Decorative only (the label text beside it names
 * the item), hence `aria-hidden`.
 */
const EquipmentIcon: React.FC<EquipmentIconProps> = ({ slug, className }) => {
  const svg = equipmentIconFor(slug);
  if (!svg.startsWith('<svg')) return null;
  return (
    <span
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default EquipmentIcon;
