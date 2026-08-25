import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Alert, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import BottomSheetPicker from '../components/BottomSheetPicker';
import MedicationNameSuggestions, { type MedicationNamePick } from '../components/MedicationNameSuggestions';
import ReconstitutionCalculator from '../components/ReconstitutionCalculator';
import {
  concentrationDraw,
  readReconstitutionRecord,
  RECONSTITUTION_FIELD,
  catalogOpensCalculator,
  resolveCatalogDrug,
  concentrationUnitLabel,
  type MedicationRouteId,
  type ReconstitutionRecord,
  type ReconstitutionUnit,
} from '@workspace/shared';
import { useMedications, useMedicationDetail, useCreateMedication, useUpdateMedication } from '../hooks/useMedications';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import FormInput from '../components/FormInput';
import Icon from '../components/Icon';
import Switch from '../components/ui/Switch';
import type { RootStackScreenProps } from '../types/navigation';
import { medicationTypeLabel } from '../utils/medicationLocalization';
import { MEDICATION_TYPES } from '../types/medications';

type MedicationFormScreenProps = RootStackScreenProps<'MedicationForm'>;

/**
 * A catalog route maps onto the dose forms this screen's type picker already offers. A starting
 * point, not a constraint — the two vocabularies overlap but are not the same thing.
 */
const CATALOG_ROUTE_TYPE: Record<MedicationRouteId, string> = {
  oral: 'pill',
  subcutaneous: 'injection',
  intramuscular: 'injection',
  topical: 'cream',
  inhaled: 'inhaler',
  nasal: 'nasal_spray',
  other: 'other',
};

interface FormState {
  name: string;
  typeId: string;
  strengthValue: string;
  strengthUnit: string;
  doseAmount: string;
  doseUnit: string;
  reason: string;
  prescriber: string;
  pharmacy: string;
  notes: string;
  isActive: boolean;
  /** Set by a catalog pick; otherwise whatever the row already had. No control edits it. */
  routeId: string | null;
  /** Which bundled catalog row this medication is, when it came from one. */
  catalogId: string | null;
  /** How this vial was mixed, when it was. Null for anything that is not a reconstituted vial. */
  reconstitution: ReconstitutionRecord | null;
}

const EMPTY_FORM: FormState = {
  name: '',
  typeId: 'pill',
  strengthValue: '',
  strengthUnit: 'mg',
  doseAmount: '',
  doseUnit: 'tablet',
  reason: '',
  prescriber: '',
  pharmacy: '',
  notes: '',
  isActive: true,
  routeId: null,
  catalogId: null,
  reconstitution: null,
};

const hasDetailsContent = (form: FormState): boolean =>
  Boolean(form.reason || form.prescriber || form.pharmacy || form.notes);

function baseFromMed(
  existingMed?: NonNullable<ReturnType<typeof useMedicationDetail>['data']>,
): FormState {
  if (!existingMed) return EMPTY_FORM;
  return {
    name: existingMed.name,
    typeId: existingMed.type_id ?? EMPTY_FORM.typeId,
    strengthValue: existingMed.strength_value != null ? String(existingMed.strength_value) : '',
    strengthUnit: existingMed.strength_unit ?? 'mg',
    doseAmount: existingMed.dose_amount != null ? String(existingMed.dose_amount) : '',
    doseUnit: existingMed.dose_unit ?? 'tablet',
    reason: existingMed.reason_text ?? '',
    prescriber: existingMed.prescriber ?? '',
    pharmacy: existingMed.pharmacy ?? '',
    notes: existingMed.notes ?? '',
    isActive: existingMed.is_active,
    routeId: existingMed.route_id ?? null,
    // Rehydrated from the stored id rather than by re-resolving the name: the user may have
    // renamed the row since, and the id is what they actually picked.
    catalogId:
      typeof existingMed.custom_fields?.['catalog_id'] === 'string'
        ? (existingMed.custom_fields['catalog_id'] as string)
        : null,
    // Null for anything that is not a complete, valid record — `custom_fields` is free-form
    // JSONB, and half a mix is worse than none when it repopulates a syringe calculator.
    reconstitution: readReconstitutionRecord(existingMed.custom_fields),
  };
}

const MedicationFormScreen: React.FC<MedicationFormScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  const medicationId = route.params?.medicationId;
  const isEditing = !!medicationId;
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const [textMuted] = useCSSVariable(['--color-text-muted']) as [string];

  const { data: existingMed } = useMedicationDetail(medicationId ?? '', { enabled: isEditing });
  const createMedication = useCreateMedication();
  const updateMedication = useUpdateMedication();

  const [edits, setEdits] = useState<Partial<FormState>>({});

  const form: FormState = useMemo(
    () => ({ ...baseFromMed(existingMed), ...edits }),
    [existingMed, edits],
  );

  // null until the user toggles; until then follow the data, so a medication
  // with detail content opens expanded even when it arrives after mount.
  const [detailsToggle, setDetailsToggle] = useState<boolean | null>(null);
  const showDetails = detailsToggle ?? hasDetailsContent(form);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Suggestions appear while the user is typing a name and go away once they have chosen. They
  // start hidden so opening an existing medication does not greet the user with a dropdown.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // Tier 1 of the name search. `activeOnly` is deliberately unset: a medication the user stopped
  // taking is still the row they are most likely to be re-adding. Gated on the dropdown being
  // open — the hook refetches on focus, and an edit that never touches the name should not pay
  // for a list read it will not show.
  const { data: ownMedications } = useMedications({ enabled: suggestionsOpen });
  // null until the user toggles, same as the details section: a medication saved with a mix
  // opens on it, rather than hiding the user's own numbers behind a ghost link.
  const [calculatorToggle, setCalculatorToggle] = useState<boolean | null>(null);
  const showCalculator = calculatorToggle ?? form.reconstitution !== null;
  // Bumped on every name pick to remount the calculator on the new medication's numbers.
  const [calcSeed, setCalcSeed] = useState(0);

  const catalogDrug = useMemo(
    () => (form.catalogId ? (resolveCatalogDrug(form.catalogId) ?? null) : null),
    [form.catalogId],
  );

  // The dose as the calculator understands it. 'tablet' and friends have no draw volume, so
  // only a mass or IU dose seeds the calculator's third field.
  const savedDose = useMemo((): { amount: number; unit: ReconstitutionUnit } | null => {
    const amount = parseFloat(form.doseAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = form.doseUnit.trim().toLowerCase();
    if (unit !== 'mg' && unit !== 'mcg' && unit !== 'iu') return null;
    return { amount, unit };
  }, [form.doseAmount, form.doseUnit]);

  // Derived from the strength and dose on the form, never from the stored mix: the marks shown
  // have to agree with the strength shown even after the user edits it by hand. Null whenever
  // the answer is not knowable — a strength that is not a concentration, or a dose that cannot
  // be converted to it.
  const draw = useMemo(
    () =>
      concentrationDraw({
        strengthValue: parseFloat(form.strengthValue),
        strengthUnit: form.strengthUnit,
        doseAmount: parseFloat(form.doseAmount),
        doseUnit: form.doseUnit.trim().toLowerCase(),
        syringe: form.reconstitution?.syringe ?? null,
      }),
    [form.strengthValue, form.strengthUnit, form.doseAmount, form.doseUnit, form.reconstitution],
  );

  const handleNamePick = useCallback(
    (pick: MedicationNamePick) => {
      setSuggestionsOpen(false);
      // The calculator seeds its fields once, at mount. A pick that leaves it open — a drug with
      // no strength ladder, picked while it was already showing — would otherwise keep the
      // previous vial's numbers prefilled under a different medication's name.
      setCalcSeed((seed) => seed + 1);
      if (pick.kind === 'custom') {
        // The mix describes a vial, not a form. Carrying it onto a different drug would prefill
        // the calculator with someone else's numbers and pick their syringe for the draw.
        setEdits((prev) => ({ ...prev, name: pick.name, catalogId: null, reconstitution: null }));
        setCalculatorToggle(false);
        return;
      }
      if (pick.kind === 'existing') {
        // The user's own row beats the catalog: their strength and dose are real data.
        const med = pick.medication;
        const savedCatalogId = med.custom_fields?.['catalog_id'];
        setEdits((prev) => ({
          ...prev,
          name: med.name,
          // Only overwrite the type when the picked row actually has one — an edit key set to
          // undefined would blank a type the medication being edited already carries.
          ...(med.type_id ? { typeId: med.type_id } : {}),
          routeId: med.route_id ?? null,
          strengthValue: med.strength_value != null ? String(med.strength_value) : '',
          strengthUnit: med.strength_unit ?? EMPTY_FORM.strengthUnit,
          doseAmount: med.dose_amount != null ? String(med.dose_amount) : '',
          doseUnit: med.dose_unit ?? EMPTY_FORM.doseUnit,
          catalogId: typeof savedCatalogId === 'string' ? savedCatalogId : null,
          // The copied row's own mix, so the strength above and the vial behind it stay the same
          // medication's. Null when it has none — never the mix that was on screen a moment ago.
          reconstitution: readReconstitutionRecord(med.custom_fields),
        }));
        setCalculatorToggle(false);
        return;
      }
      // `matchedOn`, not `displayName`: someone who typed "Sema" gets a row named Sema rather
      // than a rename to "Semaglutide" they did not ask for. Brands are their own entries, so
      // the two only differ on a synonym match.
      const { drug } = pick;
      setEdits((prev) => ({
        ...prev,
        name: pick.matchedOn,
        catalogId: drug.id,
        typeId: CATALOG_ROUTE_TYPE[drug.routes[0] ?? 'other'] ?? 'other',
        routeId: drug.routes[0] ?? null,
        reconstitution: null,
      }));
      // No approved label means no strength ladder, so for an injectable the only honest source
      // for a dose is the vial the user is holding — and the calculator opens empty, because the
      // mix that was on screen belonged to whatever this row used to be. An oral drug with no
      // ladder gets neither; see `catalogOpensCalculator`.
      setCalculatorToggle(catalogOpensCalculator(drug));
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (createMedication.isPending || updateMedication.isPending) return;

    if (!form.name.trim()) {
      Alert.alert(t('medications.form.required', { defaultValue: 'Required' }), t('medications.form.nameRequired', { defaultValue: 'Please enter a medication name.' }));
      return;
    }

    const strengthNum = form.strengthValue ? parseFloat(form.strengthValue) : null;
    const doseNum = form.doseAmount ? parseFloat(form.doseAmount) : null;

    if ((form.strengthValue && !Number.isFinite(strengthNum)) || (form.doseAmount && !Number.isFinite(doseNum))) {
      Alert.alert(t('medications.form.invalidNumber', { defaultValue: 'Invalid number' }), t('medications.form.invalidNumberMessage', { defaultValue: 'Please enter valid numeric values for strength and dose.' }));
      return;
    }

    const base = {
      name: form.name.trim(),
      type_id: form.typeId,
      strength_value: strengthNum,
      strength_unit: form.strengthUnit || null,
      dose_amount: doseNum,
      dose_unit: form.doseUnit || null,
      reason_text: form.reason.trim() || null,
      prescriber: form.prescriber.trim() || null,
      pharmacy: form.pharmacy.trim() || null,
      notes: form.notes.trim() || null,
      route_id: form.routeId,
      // Provenance, not a label: 'catalog' is what makes `catalog_id` below meaningful. A row
      // whose name was hand-typed keeps whatever it already said.
      source: form.catalogId ? 'catalog' : (existingMed?.source ?? 'manual'),
      // `catalog_id`, deliberately not `glp1_drug`: the latter gates the PK coach and only ever
      // holds a profile the registry publishes, whereas this records the catalog row picked —
      // including drugs with no PK at all.
      // Explicitly null rather than omitted when there is no match, so renaming a row off the
      // catalog actually detaches it instead of leaving the old drug's id attached.
      custom_fields: {
        ...(existingMed?.custom_fields ?? {}),
        catalog_id: form.catalogId,
        // The mix behind the strength. Explicitly null when there is none, so a vial edited
        // back into a plain strength stops claiming a draw it can no longer justify.
        [RECONSTITUTION_FIELD]: form.reconstitution,
      },
    };

    if (isEditing && medicationId) {
      updateMedication.mutate(
        { id: medicationId, body: { ...base, is_active: form.isActive } },
        {
          onSuccess: () => navigation.goBack(),
          onError: (error) => Alert.alert(t('common.error', { defaultValue: 'Error' }), t('medications.form.updateFailed', { defaultValue: 'Failed to update medication: {{error}}', error: error.message })),
        },
      );
    } else {
      createMedication.mutate(
        { ...base, is_active: form.isActive },
        {
          onSuccess: (med) => {
            navigation.replace('MedicationDetail', { medicationId: med.id });
          },
          onError: (error) => Alert.alert(t('common.error', { defaultValue: 'Error' }), t('medications.form.createFailed', { defaultValue: 'Failed to create medication: {{error}}', error: error.message })),
        },
      );
    }
  }, [form, existingMed, isEditing, medicationId, createMedication, updateMedication, navigation, t]);

  const header = useScreenHeader({
    title: isEditing ? t('medications.form.editTitle', { defaultValue: 'Edit Medication' }) : t('medications.form.newTitle', { defaultValue: 'New Medication' }),
    nativeTitle: isEditing ? t('medications.form.editTitle', { defaultValue: 'Edit Medication' }) : t('medications.form.newTitle', { defaultValue: 'New Medication' }),
    left: { kind: 'dismiss', onPress: () => navigation.goBack() },
    right: {
      kind: 'primary',
      label: t('common.save', { defaultValue: 'Save' }),
      busy: createMedication.isPending || updateMedication.isPending,
      busyLabel: t('common.saving', { defaultValue: 'Saving…' }),
      onPress: handleSave,
    },
  });

  const typeOptions = useMemo(() => MEDICATION_TYPES.map((id) => ({ label: medicationTypeLabel(id, t), value: id })), [t]);

  return (
    <View className="flex-1 bg-background" style={usesNativeHeader ? undefined : { paddingTop: insets.top }}>
      {header}
      <KeyboardAwareScrollView
        contentContainerStyle={{
          padding: 16,
          rowGap: 24,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
        <View className="gap-4">
          <View className="gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">{t('medications.form.name', { defaultValue: 'Name *' })}</Text>
            <FormInput
              placeholder={t('medications.form.namePlaceholder', { defaultValue: 'Ipsumol' })}
              value={form.name}
              onChangeText={(v) => {
                setSuggestionsOpen(true);
                // Typing over a matched name detaches the row from the catalog: leaving
                // `catalog_id` on a medication renamed to something else would attribute the
                // wrong drug's data to it.
                setEdits((prev) => ({ ...prev, name: v, catalogId: null }));
              }}
              autoCapitalize="words"
            />
            {suggestionsOpen && (
              <MedicationNameSuggestions
                query={form.name}
                ownMedications={ownMedications}
                onPick={handleNamePick}
              />
            )}
            {catalogDrug && (
              <Text className="text-text-muted text-xs">
                {t('medications.form.fromCatalog', {
                  defaultValue:
                    'Matched to {{drug}} in the built-in list. Every field below stays yours to change.',
                  drug: catalogDrug.displayName,
                })}
              </Text>
            )}
          </View>

          <View className="gap-1.5">
            <Text className="text-text-secondary text-sm font-medium">{t('medications.form.type', { defaultValue: 'Type' })}</Text>
            <BottomSheetPicker
              value={form.typeId}
              options={typeOptions}
              onSelect={(val) => updateField('typeId', val)}
              title={t('medications.form.typeTitle', { defaultValue: 'Medication Type' })}
            />
          </View>

          <View className="flex-row gap-4">
            <View className="flex-1 gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.strength', { defaultValue: 'Strength' })}</Text>
              <FormInput
                placeholder="10"
                value={form.strengthValue}
                onChangeText={(v) => updateField('strengthValue', v)}
                keyboardType="decimal-pad"
              />
            </View>
            <View className="flex-1 gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.unit', { defaultValue: 'Unit' })}</Text>
              <FormInput
                placeholder={t('medications.form.strengthUnitPlaceholder', { defaultValue: 'mg' })}
                value={form.strengthUnit}
                onChangeText={(v) => updateField('strengthUnit', v)}
              />
            </View>
          </View>

          <View className="flex-row gap-4">
            <View className="flex-1 gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.dose', { defaultValue: 'Dose' })}</Text>
              <FormInput
                placeholder="1"
                value={form.doseAmount}
                onChangeText={(v) => updateField('doseAmount', v)}
                keyboardType="decimal-pad"
              />
            </View>
            <View className="flex-1 gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.unit', { defaultValue: 'Unit' })}</Text>
              <FormInput
                placeholder={t('medications.form.doseUnitPlaceholder', { defaultValue: 'tablet' })}
                value={form.doseUnit}
                onChangeText={(v) => updateField('doseUnit', v)}
              />
            </View>
          </View>

          {/* The number the user actually acts on, sitting with the two fields it comes from.
              A strength in mg/mL is not something anyone draws — marks on a barrel are. */}
          {draw && (
            <Text testID="med-draw" className="text-text-muted text-sm">
              {t('medications.form.draw', {
                defaultValue: 'Draw {{volume}} mL — {{units}} units on a {{syringe}} syringe',
                volume: draw.drawVolumeMl,
                units: draw.syringeUnits,
                syringe: draw.syringe,
              })}
            </Text>
          )}

          {/* The dosage step. A drug with an approved label offers its ladder; one without gets
              the calculator, because the only honest source for its strength is the vial the
              user is actually holding. */}
          {catalogDrug?.strengths && (
            <View className="gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">
                {t('medications.form.labelStrengths', { defaultValue: 'Label strengths' })}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {catalogDrug.strengths.values.map((value) => {
                  const unit = catalogDrug.strengths?.unit ?? '';
                  const selected = form.strengthValue === String(value) && form.strengthUnit === unit;
                  return (
                    <TouchableOpacity
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      className={`rounded-full border px-3 py-1 ${selected ? 'border-accent-primary bg-raised' : 'border-border-subtle'}`}
                      onPress={() =>
                        setEdits((prev) => ({
                          ...prev,
                          strengthValue: String(value),
                          strengthUnit: unit,
                        }))
                      }
                    >
                      <Text className="text-text-primary text-sm">
                        {value} {unit}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text className="text-text-muted text-xs">
                {t('medications.form.labelStrengthsHint', {
                  defaultValue: 'From the approved label. Type your own above if yours differs.',
                })}
              </Text>
            </View>
          )}

          {showCalculator ? (
            <ReconstitutionCalculator
              key={calcSeed}
              vialSuggestions={catalogDrug?.vialSizes ?? []}
              intervalDays={
                catalogDrug?.cadence === 'weekly' ? 7 : catalogDrug?.cadence === 'daily' ? 1 : null
              }
              initialRecord={form.reconstitution}
              initialDose={savedDose}
              onApply={(applied) => {
                // A reconstituted vial's "strength" is what a millilitre of it contains, which
                // is what makes the dose in units meaningful later. The mix itself is kept
                // alongside it: a concentration cannot say which vial and how much water it
                // came from, and without that the calculator reopens empty.
                setEdits((prev) => ({
                  ...prev,
                  strengthValue: String(applied.concentration),
                  strengthUnit: concentrationUnitLabel(applied.concentrationUnit),
                  doseAmount: String(applied.doseAmount),
                  doseUnit: applied.doseUnit,
                  reconstitution: applied.record,
                }));
              }}
            />
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              testID="open-recon-calculator"
              className="self-start py-2"
              onPress={() => setCalculatorToggle(true)}
            >
              <Text className="text-text-muted text-sm">
                {t('medications.form.openCalculator', {
                  defaultValue: 'Reconstituting a vial? Work out the syringe units',
                })}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setDetailsToggle(!showDetails)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: showDetails }}
          className="flex-row items-center gap-1 py-2 self-start"
        >
          <Text className="text-text-primary font-medium" style={{ fontSize: 16 }}>
            {t('medications.form.details', { defaultValue: 'Details' })}
          </Text>
          <Icon name={showDetails ? 'chevron-down' : 'chevron-forward'} size={12} color={textMuted} />
        </TouchableOpacity>

        {showDetails && (
          <View className="gap-4">
            <View className="gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.reason', { defaultValue: 'Reason' })}</Text>
              <FormInput
                placeholder={t('medications.form.reasonPlaceholder', { defaultValue: 'Blood pressure' })}
                value={form.reason}
                onChangeText={(v) => updateField('reason', v)}
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.prescriber', { defaultValue: 'Prescriber' })}</Text>
              <FormInput
                placeholder={t('medications.form.prescriberPlaceholder', { defaultValue: 'Dr. Ipsum' })}
                value={form.prescriber}
                onChangeText={(v) => updateField('prescriber', v)}
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.pharmacy', { defaultValue: 'Pharmacy' })}</Text>
              <FormInput
                placeholder={t('medications.form.pharmacyPlaceholder', { defaultValue: 'Sunny Pharmacy' })}
                value={form.pharmacy}
                onChangeText={(v) => updateField('pharmacy', v)}
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-sm font-medium">{t('medications.form.notes', { defaultValue: 'Notes' })}</Text>
              <FormInput
                value={form.notes}
                onChangeText={(v) => updateField('notes', v)}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                style={{ minHeight: 72 }}
              />
            </View>
          </View>
        )}

        <View className="flex-row justify-between items-center">
          <Text className="text-base text-text-primary">{t('medications.form.active', { defaultValue: 'Active' })}</Text>
          <Switch
            value={form.isActive}
            onValueChange={(v) => updateField('isActive', v)}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
};

export default MedicationFormScreen;
