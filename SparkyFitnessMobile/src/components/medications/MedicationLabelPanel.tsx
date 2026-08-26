import React from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text } from 'react-native';
import { formatOpenFdaProductDetail } from '@workspace/shared';
import { useMedicationLabel } from '../../hooks/useMedicationLabel';

/**
 * Who makes the drug on a medication record, from the FDA's NDC directory.
 *
 * Read-only on purpose. A labeler is a fact about the *drug*, not about this prescription, so
 * nothing here is written back to the medication row — if the FDA relists a product under a new
 * labeler, the right outcome is that this panel says so, not that a record the user never edited
 * changes underneath them.
 *
 * **It renders nothing at all in every unavailable case.** A medication with no RxCUI, an owner
 * who has not opted into network drug lookups, a drug the directory does not list, and an
 * unreachable FDA are four different answers, and the client tells them apart only so it can be
 * sure none of them is worth showing. This is provenance layered under a record that has already
 * rendered; a card explaining why there is no card is worse than no card.
 *
 * The web component of the same name is its twin.
 */

interface MedicationLabelPanelProps {
  medicationId: string;
  /** The medication's stored RxCUI. Null or absent means no request is made at all. */
  rxcui?: string | null;
}

const MedicationLabelPanel: React.FC<MedicationLabelPanelProps> = ({
  medicationId,
  rxcui,
}) => {
  const { t } = useTranslation();
  const { data } = useMedicationLabel(medicationId, { rxcui });

  // No RxCUI, not opted in, not listed, or unreachable — all silent. There is deliberately no
  // loading state either: a skeleton under an already-rendered record draws the eye to small
  // print nobody asked for.
  const products = data?.products ?? [];
  if (products.length === 0) return null;

  const shown = products.length;
  const total = data?.totalMatches ?? shown;

  return (
    <View className="bg-surface rounded-xl p-4 mb-3 shadow-sm">
      <Text className="text-sm font-semibold text-text-secondary">
        {t('medications.label.title', { defaultValue: 'Product information' })}
      </Text>
      {/* Naming the source is not decoration: this is the only place the user sees that a third
          party was asked, and the count keeps a truncated list from reading as a complete one. */}
      <Text className="text-xs text-text-muted mt-0.5 mb-2">
        {total > shown
          ? t('medications.label.sourceTruncated', {
              defaultValue:
                'Showing {{shown}} of {{total}} listings from the US FDA drug directory.',
              shown,
              total,
            })
          : t('medications.label.source', {
              defaultValue:
                'From the US FDA drug directory. Not part of your record.',
            })}
      </Text>
      {products.map((product, index) => {
        const detail = formatOpenFdaProductDetail(product);
        const names = [product.brandName, product.genericName]
          .filter((name): name is string => Boolean(name))
          .join(' · ');
        return (
          <View key={product.productNdc}>
            {index > 0 && <View className="h-px bg-chrome-border my-2" />}
            <Text className="text-base text-text-primary">
              {/* A listing with no labeler is still worth showing — the NDC identifies the
                  product either way, which is the one field that always exists. */}
              {product.labelerName ??
                t('medications.label.unknownLabeler', {
                  defaultValue: 'Labeler not stated',
                })}
            </Text>
            {names !== '' && (
              <Text className="text-sm text-text-muted mt-0.5">{names}</Text>
            )}
            {detail !== null && (
              <Text className="text-sm text-text-muted mt-0.5">{detail}</Text>
            )}
            <Text className="text-xs text-text-muted mt-1">
              {t('medications.label.ndc', {
                defaultValue: 'NDC {{ndc}}',
                ndc: product.productNdc,
              })}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

export default MedicationLabelPanel;
