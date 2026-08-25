import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import {
  catalogRowSubtitle,
  searchCatalog,
  type CatalogDrug,
  type Medication,
} from '@workspace/shared';
import Icon from './Icon';

/**
 * What the user chose. Mirrors the web combobox's pick type so both platforms apply a match the
 * same way; the screen owns which fields a pick fills in.
 */
export type MedicationNamePick =
  | { kind: 'existing'; medication: Medication }
  | { kind: 'catalog'; drug: CatalogDrug; matchedOn: string }
  | { kind: 'custom'; name: string };

type Row =
  | { key: string; kind: 'existing'; medication: Medication }
  | { key: string; kind: 'catalog'; drug: CatalogDrug; matchedOn: string; viaAlias: boolean }
  | { key: string; kind: 'custom' };

const MAX_OWN = 3;
const MAX_CATALOG = 5;

/**
 * Suggestions under the medication name field: the user's own cabinet first, then the bundled
 * catalog, then an always-present row for a name neither list has.
 *
 * Deliberately an inline list rather than a floating dropdown. The form is a scroll view over a
 * keyboard, and an absolutely-positioned popover there fights the keyboard avoider on both
 * platforms; pushing the fields down is honest and needs no overlay.
 */
export default function MedicationNameSuggestions({
  query,
  ownMedications,
  onPick,
}: {
  query: string;
  ownMedications: Medication[] | undefined;
  onPick: (pick: MedicationNamePick) => void;
}) {
  const { t } = useTranslation();
  const [textMuted] = useCSSVariable(['--color-text-muted']) as [string];

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const needle = trimmed.toLowerCase();

    const own = (ownMedications ?? [])
      .filter((med) =>
        `${med.name} ${med.display_name ?? ''}`.toLowerCase().includes(needle),
      )
      .slice(0, MAX_OWN)
      .map<Row>((med) => ({ key: `own:${med.id}`, kind: 'existing', medication: med }));

    // A drug the user already has under that name is better represented by their own row, which
    // carries their strength and schedule.
    const ownNames = new Set(
      own.map((row) => (row.kind === 'existing' ? row.medication.name.trim().toLowerCase() : '')),
    );

    const catalog = searchCatalog(trimmed, MAX_CATALOG)
      .filter((hit) => !ownNames.has(hit.drug.displayName.toLowerCase()))
      .map<Row>((hit) => ({
        key: `catalog:${hit.drug.id}`,
        kind: 'catalog',
        drug: hit.drug,
        matchedOn: hit.matchedOn,
        viaAlias: hit.viaAlias,
      }));

    return [...own, ...catalog, { key: 'custom', kind: 'custom' }];
  }, [ownMedications, query]);

  if (rows.length === 0) return null;

  const firstCatalogIndex = rows.findIndex((row) => row.kind === 'catalog');
  const hasOwn = rows.some((row) => row.kind === 'existing');

  return (
    <View className="rounded-lg border border-border-subtle overflow-hidden">
      {rows.map((row, index) => (
        <View key={row.key}>
          {index === 0 && hasOwn && (
            <Text className="px-3 pt-2 pb-1 text-text-muted text-xs font-semibold uppercase">
              {t('medications.search.yours', { defaultValue: 'Your medications' })}
            </Text>
          )}
          {index === firstCatalogIndex && firstCatalogIndex >= 0 && (
            <Text className="px-3 pt-2 pb-1 text-text-muted text-xs font-semibold uppercase">
              {t('medications.search.known', { defaultValue: 'Known drugs' })}
            </Text>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            testID={`med-suggestion-${row.key}`}
            className="flex-row items-center gap-2 px-3 py-3"
            onPress={() => {
              if (row.kind === 'existing') {
                onPick({ kind: 'existing', medication: row.medication });
              } else if (row.kind === 'catalog') {
                onPick({ kind: 'catalog', drug: row.drug, matchedOn: row.matchedOn });
              } else {
                onPick({ kind: 'custom', name: query.trim() });
              }
            }}
          >
            <Icon
              name={
                row.kind === 'existing'
                  ? 'medication'
                  : row.kind === 'catalog'
                    ? 'sparkles'
                    : 'add'
              }
              size={18}
              color={textMuted}
            />
            <Text className="flex-1 text-text-primary text-base" numberOfLines={1}>
              {row.kind === 'existing'
                ? row.medication.display_name || row.medication.name
                : row.kind === 'catalog'
                  ? row.matchedOn
                  : t('medications.search.addCustom', {
                      defaultValue: 'Add "{{name}}" as a custom medication',
                      name: query.trim(),
                    })}
            </Text>
            {row.kind === 'catalog' && catalogRowSubtitle(row.drug, row.viaAlias) && (
              <Text className="text-text-muted text-xs">
                {catalogRowSubtitle(row.drug, row.viaAlias)}
              </Text>
            )}
            {row.kind === 'existing' && row.medication.strength_value != null && (
              <Text className="text-text-muted text-xs">
                {row.medication.strength_value}
                {row.medication.strength_unit ?? ''}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
