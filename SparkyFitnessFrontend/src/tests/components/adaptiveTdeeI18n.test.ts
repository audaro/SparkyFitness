import i18n from 'i18next';
import en from '../../../public/locales/en/translation.json';
import de from '../../../public/locales/de/translation.json';
import es from '../../../public/locales/es/translation.json';
import ru from '../../../public/locales/ru/translation.json';

/**
 * Real i18next, not the component mock. skipOnVariables leaves `{{name}}` in
 * the string when a value is missing, which is exactly how the Adaptive TDEE
 * panel rendered raw placeholders after the first unit-aware translation pass.
 */
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: { translation: de },
      es: { translation: es },
      ru: { translation: ru },
    },
  });
});

const lbsVars = {
  start: '252.6 lbs',
  end: '244.5 lbs',
  change: '-8.20 lbs',
  days: 28,
  daily: '-0.2928',
  massUnit: 'lbs',
  unit: 'lbs',
  unitName: 'pound',
  kcalPerUnit: 2722,
  kcalPerKg: 6000,
  fatPerKg: '9,441',
  leanPerKg: '1,816',
  fatPerUnit: '4,282',
  leanPerUnit: '824',
  value: '+797 kcal',
};

describe('Adaptive TDEE translation interpolation', () => {
  it('fills every placeholder in the English formula, explainer, and weight-trend lines', () => {
    const formula = i18n.t('settings.breakdown.adaptiveFormula', lbsVars);
    const explainer = i18n.t(
      'settings.breakdown.adaptiveFormulaExplainer',
      lbsVars
    );
    const trend = i18n.t('diary.calculateExplanation.weightTrendTerm', lbsVars);
    const energy = i18n.t(
      'diary.calculateExplanation.weightTrendCalories',
      lbsVars
    );

    for (const text of [formula, explainer, trend, energy]) {
      expect(text).not.toMatch(/\{\{/);
    }
    expect(trend).toContain('252.6 lbs → 244.5 lbs');
    expect(trend).toContain('-8.20 lbs');
    expect(trend).toContain('-0.2928 lbs');
    expect(formula).toContain('in lbs × 2722 kcal/lbs');
  });

  /**
   * Weblate syncs locales one at a time, so a locale is either on the
   * unit-aware copy ({{kcalPerUnit}}/{{massUnit}}) or still on the legacy
   * kg-only copy ({{kcalPerKg}}). Derive which from the catalog instead of
   * hardcoding a locale list that goes stale on the next sync.
   */
  const catalogs = { de, es, ru } as const;

  it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
    'renders the %s formula copy against whichever density its catalog uses',
    (lng) => {
      const source = catalogs[lng].settings.breakdown.adaptiveFormula;
      const unitAware = source.includes('{{kcalPerUnit}}');

      const formula = i18n.t('settings.breakdown.adaptiveFormula', {
        lng,
        ...lbsVars,
      });
      const explainer = i18n.t('settings.breakdown.adaptiveFormulaExplainer', {
        lng,
        ...lbsVars,
      });

      expect(formula).not.toMatch(/\{\{/);
      expect(explainer).not.toMatch(/\{\{/);

      // Synced locales print the per-lb figure; unsynced ones still say
      // "kg" / "кг" and must keep the kg density, never the converted per-lb number.
      const expected = unitAware ? '2722' : '6000';
      const forbidden = unitAware ? '6000' : '2722';
      expect(formula).toContain(expected);
      expect(formula).not.toContain(forbidden);
      expect(explainer).toContain(expected);
      expect(explainer).not.toContain(forbidden);
    }
  );
});
