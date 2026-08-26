import type { TFunction } from 'i18next';
import type {
  ReconstitutionFailure,
  ReconstitutionWarning,
} from '@workspace/shared';

/**
 * Localised text for every refusal and caution `reconstitute()` can return.
 *
 * `shared` has no translator, so the `message` it carries is English-only — a fallback for a
 * caller with no i18n, not the thing a localised UI renders. What the result *does* carry is a
 * stable `reason` / `code` plus `details`: exactly the values its sentence interpolates. That is
 * enough to rebuild the same sentence in the user's own language, which is what these do.
 *
 * Both switches are deliberately exhaustive with no `default` branch: a new reason added in
 * `shared` fails the typecheck here rather than silently falling back to English in a language
 * the user does not read.
 */
export function localizeReconstitutionFailure(
  t: TFunction,
  failure: ReconstitutionFailure,
): string {
  const d = failure.details;
  switch (failure.reason) {
    case 'invalid_vial_amount':
      return t('medications.recon.errors.invalidVialAmount', {
        defaultValue:
          'Enter how much the vial contains, as a number greater than zero.',
      });
    case 'invalid_diluent':
      return t('medications.recon.errors.invalidDiluent', {
        defaultValue:
          'Enter how much diluent you added, in mL, as a number greater than zero.',
      });
    case 'invalid_dose':
      return t('medications.recon.errors.invalidDose', {
        defaultValue: 'Enter your dose as a number greater than zero.',
      });
    case 'invalid_syringe':
      return t('medications.recon.errors.invalidSyringe', {
        defaultValue:
          'Unknown syringe standard "{{syringe}}". Supported: U-100, U-40.',
        ...d,
      });
    case 'invalid_syringe_capacity':
      return t('medications.recon.errors.invalidSyringeCapacity', {
        defaultValue:
          'Syringe capacity must be a number of units greater than zero.',
      });
    case 'invalid_target_units':
      return t('medications.recon.errors.invalidTargetUnits', {
        defaultValue:
          'Enter the number of units you want to draw, greater than zero.',
      });
    case 'invalid_interval':
      return t('medications.recon.errors.invalidInterval', {
        defaultValue: 'Days between doses must be a number greater than zero.',
      });
    case 'unit_mismatch':
      return t('medications.recon.errors.unitMismatch', {
        defaultValue:
          'A vial measured in {{vialUnit}} cannot be dosed in {{doseUnit}}. IU and mg are not interchangeable — the factor depends on the substance.',
        ...d,
      });
    case 'dose_exceeds_vial':
      return t('medications.recon.errors.doseExceedsVial', {
        defaultValue:
          'A {{doseAmount}} {{doseUnit}} dose is more than the vial holds ({{vialAmount}} {{vialUnit}}).',
        ...d,
      });
    case 'not_finite':
      return t('medications.recon.errors.notFinite', {
        defaultValue:
          'Could not compute a reliable result from those numbers. Check the vial, diluent and dose.',
      });
  }
}

export function localizeReconstitutionWarning(
  t: TFunction,
  warning: ReconstitutionWarning,
): string {
  const d = warning.details;
  switch (warning.code) {
    case 'exceeds_syringe_capacity':
      return t('medications.recon.warnings.exceedsSyringeCapacity', {
        defaultValue:
          '{{units}} units is more than a {{capacityUnits}}-unit {{syringe}} syringe holds. Use a larger syringe, split the draw, or add less diluent.',
        ...d,
      });
    case 'below_measurable_precision':
      return t('medications.recon.warnings.belowMeasurablePrecision', {
        defaultValue:
          '{{units}} units is below what a syringe barrel measures reliably. Add more diluent so the same dose draws to a larger volume.',
        ...d,
      });
  }
}
