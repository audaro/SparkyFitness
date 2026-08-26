import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';
import { formatOpenFdaProductDetail } from '@workspace/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useMedicationLabel } from '@/hooks/useMedicationLabel';
import type { Medication } from '@/types/medications';

/**
 * Who makes the drug on a medication record, from the FDA's NDC directory.
 *
 * Read-only on purpose. A labeler is a fact about the *drug*, not about this prescription, so
 * nothing here is written back to the medication row — if the FDA relists a product under a new
 * labeler, the right outcome is that this panel says so, not that a record the user never edited
 * changes underneath them. `medications.ndc` remains theirs to fill in by hand.
 *
 * **It renders nothing at all in every unavailable case.** A medication with no RxCUI, an owner
 * who has not opted into network drug lookups, a drug the directory does not list, and an
 * unreachable FDA are four different answers, and the client tells them apart only so it can be
 * sure none of them is worth showing. This panel is provenance layered under a record that has
 * already rendered; an empty card explaining why there is no card is worse than no card.
 */

interface MedicationLabelPanelProps {
  medication: Medication;
}

export default function MedicationLabelPanel({
  medication,
}: MedicationLabelPanelProps) {
  const { t } = useTranslation();
  const { data } = useMedicationLabel(medication.id, {
    rxcui: medication.rxnorm_rxcui,
  });

  // No RxCUI, not opted in, not listed, or unreachable — all silent. There is deliberately no
  // loading state either: a skeleton here would resolve to nothing whenever the FDA has no
  // listing, and a card that appears and then vanishes is worse than one that never appeared.
  const products = data?.products ?? [];
  if (products.length === 0) return null;

  const shown = products.length;
  const total = data?.totalMatches ?? shown;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Factory className="h-4 w-4 text-primary" />
          {t('medications.label.title', 'Product information')}
        </CardTitle>
        <CardDescription className="text-xs">
          {/* Naming the source is not decoration: this is the only place the user sees that a
              third party was asked, and the count keeps a truncated list from reading as a
              complete one. */}
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
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {products.map((product) => {
          const detail = formatOpenFdaProductDetail(product);
          return (
            <div
              key={product.productNdc}
              className="rounded-lg bg-muted/40 p-2 border text-xs"
            >
              <p className="font-medium">
                {/* A listing with no labeler is still worth showing — the NDC identifies the
                    product either way, which is the one field that always exists. */}
                {product.labelerName ??
                  t('medications.label.unknownLabeler', 'Labeler not stated')}
              </p>
              {(product.brandName || product.genericName) && (
                <p className="text-muted-foreground mt-0.5">
                  {[product.brandName, product.genericName]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {detail && (
                <p className="text-muted-foreground mt-0.5">{detail}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('medications.label.ndc', {
                  defaultValue: 'NDC {{ndc}}',
                  ndc: product.productNdc,
                })}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
