import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import {
  catalogRowSubtitle,
  rankOwnMedications,
  rxTermsStrengthHint,
  searchCatalog,
  type CatalogDrug,
  type Medication,
  type RxTermsProduct,
} from '@workspace/shared';
import { useMedicationCatalogSearch } from '../hooks/useMedicationCatalogSearch';
import Icon from './Icon';

/**
 * What the user chose. Mirrors the web combobox's pick type so both platforms apply a match the
 * same way; the screen owns which fields a pick fills in.
 */
export type MedicationNamePick =
  | { kind: 'existing'; medication: Medication }
  | { kind: 'catalog'; drug: CatalogDrug; matchedOn: string }
  | { kind: 'rxterms'; product: RxTermsProduct }
  | { kind: 'custom'; name: string };

type Row =
  | { key: string; kind: 'existing'; medication: Medication }
  | {
      key: string;
      kind: 'catalog';
      drug: CatalogDrug;
      matchedOn: string;
      viaAlias: boolean;
      viaTypo: boolean;
    }
  | { key: string; kind: 'rxterms'; product: RxTermsProduct }
  | { key: string; kind: 'custom' };

const MAX_OWN = 3;
const MAX_CATALOG = 5;

/**
 * Tier 3 is capped hardest of the three. It is the least specific to this user — a list of every
 * US product, where the two tiers above are their own cabinet and a hand-curated list — so it gets
 * the fewest rows and always sits below them.
 */
const MAX_RXTERMS = 5;

/**
 * Suggestions under the medication name field: the user's own cabinet first, then the bundled
 * catalog, then the US drug catalog if the user opted in, then an always-present row for a name
 * none of them has.
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

  // Tier 3: the US drug catalog, over the network, only if the user opted in. The hook owns the
  // debounce, the character threshold and the opt-in check, and answers with an empty list for
  // every failure — so nothing below has to think about the NIH being down.
  //
  // No `active` flag is passed because this component *is* the flag: the form mounts it only
  // while the suggestion list is open, so an edit that never touches the name never renders it
  // and never asks.
  const { products: rxTermsProducts, correctedTerms } = useMedicationCatalogSearch(query, {
    limit: MAX_RXTERMS,
  });

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Ranked by use rather than by alphabet: with more matches than rows, the drugs this user
    // actually takes are the ones worth the three slots. See `rankOwnMedications`.
    const own = rankOwnMedications(ownMedications ?? [], trimmed, MAX_OWN).map<Row>((med) => ({
      key: `own:${med.id}`,
      kind: 'existing',
      medication: med,
    }));

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
        viaTypo: hit.viaTypo,
      }));

    // The server already drops any tier 3 product the curated catalog covers. What it cannot know
    // is what the user has in their own cabinet, so the tier 1 filter is repeated here — matched
    // on the base name, since RxTerms displays `Testosterone (Injectable)` where their row says
    // `Testosterone`.
    const rxTerms = rxTermsProducts
      .filter((product) => !ownNames.has(product.baseName.trim().toLowerCase()))
      .slice(0, MAX_RXTERMS)
      .map<Row>((product) => ({
        key: `rxterms:${product.displayName}`,
        kind: 'rxterms',
        product,
      }));

    return [...own, ...catalog, ...rxTerms, { key: 'custom', kind: 'custom' }];
  }, [ownMedications, query, rxTermsProducts]);

  if (rows.length === 0) return null;

  const firstCatalogIndex = rows.findIndex((row) => row.kind === 'catalog');
  const firstRxTermsIndex = rows.findIndex((row) => row.kind === 'rxterms');
  const hasOwn = rows.some((row) => row.kind === 'existing');

  // `searchCatalog` runs its fuzzy pass only when the substring pass found nothing, so tier 2 is
  // all-or-nothing here and the first row speaks for the whole group.
  const firstCatalogRow = rows[firstCatalogIndex];
  const catalogViaTypo = firstCatalogRow?.kind === 'catalog' && firstCatalogRow.viaTypo;

  /** The right-hand hint on a tier 3 row, in words. Which case a product is in is shared logic. */
  const strengthHintText = (product: RxTermsProduct): string => {
    const hint = rxTermsStrengthHint(product);
    if (!hint) return '';
    return hint.kind === 'single'
      ? `${hint.value} ${hint.unit}`
      : t('medications.search.strengthCount', {
          defaultValue: '{{count}} strengths',
          count: hint.count,
        });
  };

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
              {/* A near-miss group says so. The difference between "here is your drug" and "here
                  is a drug spelled a bit like what you typed" is the difference between a
                  suggestion and a wrong medication record. */}
              {catalogViaTypo
                ? t('medications.search.knownTypo', { defaultValue: 'Did you mean' })
                : t('medications.search.known', { defaultValue: 'Known drugs' })}
            </Text>
          )}
          {index === firstRxTermsIndex && firstRxTermsIndex >= 0 && (
            <View className="px-3 pt-2 pb-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-text-muted text-xs font-semibold uppercase">
                  {t('medications.search.usCatalog', { defaultValue: 'US drug catalog' })}
                </Text>
                {/* Named, not just styled. These rows come from someone else's data — the NIH's —
                    and a user comparing a row against their own label deserves to know which list
                    said it. */}
                <Text className="rounded border border-border-subtle px-1 text-text-muted text-[10px] font-medium">
                  {t('medications.search.nlmTag', { defaultValue: 'NLM' })}
                </Text>
              </View>
              {correctedTerms.length > 0 && (
                // The server retried under a different spelling. Saying which one is not a
                // nicety: without it these rows read as confirmation that the drug was spelled
                // correctly, and one of them is routinely a different drug — RxNav answers a
                // metformin typo with merbromin first.
                <Text className="text-text-muted text-xs">
                  {t('medications.search.correctedTo', {
                    defaultValue: 'Showing results for {{terms}}',
                    terms: correctedTerms.join(', '),
                  })}
                </Text>
              )}
            </View>
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
              } else if (row.kind === 'rxterms') {
                onPick({ kind: 'rxterms', product: row.product });
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
                    : row.kind === 'rxterms'
                      ? 'globe'
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
                  : row.kind === 'rxterms'
                    ? // The dose form is part of the identity, not decoration: RxTerms lists
                      // Testosterone as an injectable, a topical and a patch, and the three rows
                      // are otherwise the same word.
                      <>
                        {row.product.baseName}
                        {row.product.doseForm && (
                          <Text className="text-text-muted text-xs">
                            {' '}
                            {row.product.doseForm}
                          </Text>
                        )}
                      </>
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
            {/* What the pick is worth, said before it is made. One strength fills the field
                outright; several mean a choice follows, and the count is the honest way to say so
                without listing eight products under one name. */}
            {row.kind === 'rxterms' && (
              <Text className="text-text-muted text-xs">{strengthHintText(row.product)}</Text>
            )}
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
