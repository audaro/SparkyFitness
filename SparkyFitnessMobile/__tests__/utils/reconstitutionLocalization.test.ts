import type {
  ReconstitutionErrorReason,
  ReconstitutionFailure,
  ReconstitutionWarning,
  ReconstitutionWarningCode,
} from '@workspace/shared';

import i18n, { initializeI18n } from '../../src/localization/i18n';
import {
  localizeReconstitutionFailure,
  localizeReconstitutionWarning,
} from '../../src/utils/reconstitutionLocalization';

/**
 * `reconstitute()` lives in `shared`, which has no translator: its `message` is English-only.
 * These assert that the UI never has to fall back to it — that every `reason` and `code` has a
 * real entry in both catalogs, and that `details` carries every value the sentence names.
 */

function failure(
  reason: ReconstitutionErrorReason,
  details: Record<string, string | number> = {},
): ReconstitutionFailure {
  // `message` is the English fallback the localizer deliberately never reads; a value here that
  // could never be rendered is the point — if it leaks, the wiring is wrong.
  return { ok: false, reason, message: 'UNTRANSLATED', details };
}

function warning(
  code: ReconstitutionWarningCode,
  details: Record<string, string | number>,
): ReconstitutionWarning {
  return { code, message: 'UNTRANSLATED', details };
}

// Keyed by the union rather than a plain array: a reason added in `shared` fails to compile here
// until it has a case, so this list cannot quietly stop covering what the UI can be handed.
const FAILURES_BY_REASON: Record<
  ReconstitutionErrorReason,
  ReconstitutionFailure
> = {
  invalid_vial_amount: failure('invalid_vial_amount'),
  invalid_diluent: failure('invalid_diluent'),
  invalid_dose: failure('invalid_dose'),
  invalid_syringe: failure('invalid_syringe', { syringe: 'U-500' }),
  invalid_syringe_capacity: failure('invalid_syringe_capacity'),
  invalid_target_units: failure('invalid_target_units'),
  invalid_interval: failure('invalid_interval'),
  unit_mismatch: failure('unit_mismatch', { vialUnit: 'iu', doseUnit: 'mg' }),
  dose_exceeds_vial: failure('dose_exceeds_vial', {
    doseAmount: 20,
    doseUnit: 'mg',
    vialAmount: 10,
    vialUnit: 'mg',
  }),
  not_finite: failure('not_finite'),
};

const WARNINGS_BY_CODE: Record<
  ReconstitutionWarningCode,
  ReconstitutionWarning
> = {
  exceeds_syringe_capacity: warning('exceeds_syringe_capacity', {
    units: 160,
    capacityUnits: 100,
    syringe: 'U-100',
  }),
  below_measurable_precision: warning('below_measurable_precision', {
    units: 1,
  }),
};

const FAILURES = Object.values(FAILURES_BY_REASON);
const WARNINGS = Object.values(WARNINGS_BY_CODE);

describe('reconstitution message localization', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each(['en', 'pl'] as const)(
    'renders every refusal and caution in %s with no placeholder left raw',
    async (language) => {
      await i18n.changeLanguage(language);

      for (const f of FAILURES) {
        const text = localizeReconstitutionFailure(i18n.t, f);
        expect(text).not.toContain('{{');
        expect(text).not.toContain('UNTRANSLATED');
        expect(text).not.toContain(f.reason);
      }
      for (const w of WARNINGS) {
        const text = localizeReconstitutionWarning(i18n.t, w);
        expect(text).not.toContain('{{');
        expect(text).not.toContain('UNTRANSLATED');
        expect(text).not.toContain(w.code);
      }
    },
  );

  it('has a real Polish string for every reason, not an English fallback', async () => {
    const english = FAILURES.map((f) => localizeReconstitutionFailure(i18n.t, f));
    const englishWarnings = WARNINGS.map((w) =>
      localizeReconstitutionWarning(i18n.t, w),
    );

    await i18n.changeLanguage('pl');

    // fallbackLng is 'en', so a missing PL key renders the English sentence silently. Text that
    // is identical in both languages is that fallback, which is the bug this whole change fixes.
    FAILURES.forEach((f, index) => {
      expect(localizeReconstitutionFailure(i18n.t, f)).not.toBe(english[index]);
    });
    WARNINGS.forEach((w, index) => {
      expect(localizeReconstitutionWarning(i18n.t, w)).not.toBe(
        englishWarnings[index],
      );
    });
  });

  it('interpolates the details into both languages', async () => {
    const exceedsVial = FAILURES_BY_REASON.dose_exceeds_vial;

    expect(localizeReconstitutionFailure(i18n.t, exceedsVial)).toBe(
      'A 20 mg dose is more than the vial holds (10 mg).',
    );

    await i18n.changeLanguage('pl');
    const polish = localizeReconstitutionFailure(i18n.t, exceedsVial);

    expect(polish).toContain('20 mg');
    expect(polish).toContain('10 mg');
    expect(polish).not.toBe('A 20 mg dose is more than the vial holds (10 mg).');
  });
});
