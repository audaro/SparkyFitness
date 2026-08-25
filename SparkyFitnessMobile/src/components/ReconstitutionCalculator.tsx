import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  reconstitute,
  SYRINGE_UNITS_PER_ML,
  type CatalogVialSize,
  type ReconstitutionUnit,
  type SyringeStandard,
} from '@workspace/shared';
import FormInput from './FormInput';
import SegmentedControl from './SegmentedControl';

const UNITS: ReconstitutionUnit[] = ['mg', 'mcg', 'iu'];
const SYRINGES: SyringeStandard[] = ['U-100', 'U-40'];

export interface ReconstitutionApplied {
  /** Amount per mL after reconstitution — the medication's strength. */
  concentration: number;
  concentrationUnit: ReconstitutionUnit;
  doseAmount: number;
  doseUnit: ReconstitutionUnit;
}

const unitLabel = (unit: ReconstitutionUnit) => (unit === 'iu' ? 'IU' : unit);

/**
 * Turns a vial, a diluent volume and a dose into units on an insulin syringe. The web component
 * of the same name is the same calculation and the same refusals — both call the one shared
 * `reconstitute()`, so neither platform can drift into its own arithmetic.
 */
export default function ReconstitutionCalculator({
  vialSuggestions = [],
  intervalDays,
  onApply,
}: {
  vialSuggestions?: CatalogVialSize[];
  intervalDays?: number | null;
  onApply?: (applied: ReconstitutionApplied) => void;
}) {
  const { t } = useTranslation();
  const [vialAmount, setVialAmount] = useState('');
  const [vialUnit, setVialUnit] = useState<ReconstitutionUnit>('mg');
  const [diluentMl, setDiluentMl] = useState('');
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState<ReconstitutionUnit>('mg');
  const [syringe, setSyringe] = useState<SyringeStandard>('U-100');

  // Blank is "not filled in yet", not zero: refusing before the user has typed anything would be
  // shouting at them for a mistake they have not made.
  const complete = vialAmount !== '' && diluentMl !== '' && doseAmount !== '';

  const result = useMemo(() => {
    if (!complete) return null;
    return reconstitute({
      vial: { amount: Number(vialAmount), unit: vialUnit },
      diluentMl: Number(diluentMl),
      dose: { amount: Number(doseAmount), unit: doseUnit },
      syringe,
      intervalDays: intervalDays ?? null,
    });
  }, [complete, vialAmount, vialUnit, diluentMl, doseAmount, doseUnit, syringe, intervalDays]);

  return (
    <View className="gap-3 rounded-lg border border-border-subtle p-3">
      <Text className="text-text-primary text-sm font-semibold">
        {t('medications.recon.title', { defaultValue: 'Reconstitution calculator' })}
      </Text>

      {vialSuggestions.length > 0 && (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-text-muted text-xs">
            {t('medications.recon.commonVials', { defaultValue: 'Common vials:' })}
          </Text>
          {vialSuggestions.map((vial) => (
            <TouchableOpacity
              key={`${vial.amount}-${vial.unit}`}
              accessibilityRole="button"
              className="rounded-full border border-border-subtle px-3 py-1"
              onPress={() => {
                setVialAmount(String(vial.amount));
                setVialUnit(vial.unit);
              }}
            >
              <Text className="text-text-primary text-xs">
                {vial.amount} {unitLabel(vial.unit)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View className="gap-1.5">
        <Text className="text-text-secondary text-sm font-medium">
          {t('medications.recon.vial', { defaultValue: 'Vial contains' })}
        </Text>
        <FormInput
          testID="recon-vial"
          keyboardType="decimal-pad"
          placeholder="10"
          value={vialAmount}
          onChangeText={setVialAmount}
        />
        <SegmentedControl
          segments={UNITS.map((unit) => ({ key: unit, label: unitLabel(unit) }))}
          activeKey={vialUnit}
          onSelect={setVialUnit}
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-text-secondary text-sm font-medium">
          {t('medications.recon.diluent', { defaultValue: 'Bacteriostatic water (mL)' })}
        </Text>
        <FormInput
          testID="recon-diluent"
          keyboardType="decimal-pad"
          placeholder="2"
          value={diluentMl}
          onChangeText={setDiluentMl}
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-text-secondary text-sm font-medium">
          {t('medications.recon.dose', { defaultValue: 'Your dose' })}
        </Text>
        <FormInput
          testID="recon-dose"
          keyboardType="decimal-pad"
          placeholder="2"
          value={doseAmount}
          onChangeText={setDoseAmount}
        />
        <SegmentedControl
          segments={UNITS.map((unit) => ({ key: unit, label: unitLabel(unit) }))}
          activeKey={doseUnit}
          onSelect={setDoseUnit}
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-text-secondary text-sm font-medium">
          {t('medications.recon.syringe', { defaultValue: 'Syringe' })}
        </Text>
        <SegmentedControl
          segments={SYRINGES.map((standard) => ({
            key: standard,
            label: `${standard} (${SYRINGE_UNITS_PER_ML[standard]} ${t('medications.recon.unitsPerMl', { defaultValue: 'units/mL' })})`,
          }))}
          activeKey={syringe}
          onSelect={setSyringe}
        />
      </View>

      {result && !result.ok && (
        <Text testID="recon-error" className="text-text-danger-subtle text-sm">
          {result.message}
        </Text>
      )}

      {result?.ok && (
        <View className="gap-2">
          <View className="rounded-lg bg-raised p-3">
            <Text testID="recon-units" className="text-text-primary text-2xl font-bold">
              {result.syringeUnits}{' '}
              <Text className="text-text-muted text-base font-medium">
                {t('medications.recon.units', { defaultValue: 'units' })} ({result.syringe})
              </Text>
            </Text>
            <Text className="text-text-muted text-sm">
              {t('medications.recon.detail', {
                defaultValue:
                  '{{concentration}} {{unit}}/mL · draw {{volume}} mL · {{doses}} doses per vial',
                concentration: result.concentration,
                unit: unitLabel(result.concentrationUnit),
                volume: result.drawVolumeMl,
                doses: result.dosesPerVial,
              })}
            </Text>
            {result.vialLastsDays != null && (
              <Text className="text-text-muted text-sm">
                {t('medications.recon.lasts', {
                  defaultValue: 'Vial lasts about {{days}} days',
                  days: result.vialLastsDays,
                })}
              </Text>
            )}
          </View>

          {result.warnings.map((warning) => (
            <Text key={warning.code} className="text-text-warning text-sm">
              {warning.message}
            </Text>
          ))}

          {onApply && (
            <TouchableOpacity
              accessibilityRole="button"
              testID="recon-apply"
              className="self-start rounded-lg bg-raised px-3 py-2"
              onPress={() =>
                onApply({
                  concentration: result.concentration,
                  concentrationUnit: result.concentrationUnit,
                  doseAmount: Number(doseAmount),
                  doseUnit,
                })
              }
            >
              <Text className="text-text-primary text-sm font-medium">
                {t('medications.recon.apply', { defaultValue: 'Use these numbers' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Adjacent, not buried: the framing sits with the number, whatever else is on screen. */}
      <Text className="text-text-muted text-xs">
        {t('medications.recon.framing', {
          defaultValue:
            'This converts the numbers you entered. It does not recommend a dose — check it against your own supply and your prescriber.',
        })}
      </Text>
    </View>
  );
}
