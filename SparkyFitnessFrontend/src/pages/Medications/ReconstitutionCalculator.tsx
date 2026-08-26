import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Syringe } from 'lucide-react';
import {
  reconstitute,
  SYRINGE_UNITS_PER_ML,
  type CatalogVialSize,
  type ReconstitutionDiluent,
  type ReconstitutionRecord,
  type ReconstitutionUnit,
  type SyringeStandard,
} from '@workspace/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  reconstitutionFailureMessage,
  reconstitutionWarningMessage,
} from './reconstitutionMessages';
import SyringeDiagram from './SyringeDiagram';

const UNITS: ReconstitutionUnit[] = ['mg', 'mcg', 'iu'];
const SYRINGES: SyringeStandard[] = ['U-100', 'U-40'];
const DILUENTS: ReconstitutionDiluent[] = [
  'bacteriostatic_water',
  'bacteriostatic_saline',
  'sterile_water',
  'sterile_saline',
];

/**
 * What the form opens on. Bacteriostatic water is both the common case and what this screen
 * used to *assert* — its volume field was literally labelled "Bacteriostatic water (mL)" — so
 * defaulting to it changes no arithmetic and makes the assumption visible and changeable
 * instead of silent.
 */
const DEFAULT_DILUENT: ReconstitutionDiluent = 'bacteriostatic_water';

export interface ReconstitutionApplied {
  /** Amount per mL after reconstitution — the medication's strength. */
  concentration: number;
  concentrationUnit: ReconstitutionUnit;
  doseAmount: number;
  doseUnit: ReconstitutionUnit;
  /**
   * The mix these numbers came out of, for the caller to persist. A concentration alone cannot
   * say whether it was a 30 mg vial in 3 mL or a 10 mg vial in 1 mL, so without this the
   * calculator opens blank on the next edit and the derivation is gone.
   */
  record: ReconstitutionRecord;
}

/**
 * Turns a vial, a diluent volume and a dose into units on an insulin syringe.
 *
 * It converts numbers the user entered. It does not recommend a dose, and it never fills its
 * own inputs from the catalog — vial sizes arrive as tappable suggestions, and the field stays
 * a free input, because grey-market vial sizes vary by vendor.
 */
export default function ReconstitutionCalculator({
  vialSuggestions = [],
  intervalDays,
  initialRecord = null,
  initialDose = null,
  onApply,
}: {
  vialSuggestions?: CatalogVialSize[];
  /** Days between doses, when the schedule already knows. Drives "vial lasts". */
  intervalDays?: number | null;
  /**
   * The mix this medication was last saved with, so an edit reopens on the user's own numbers
   * instead of an empty form. Read once, as the initial state — the user is free to change any
   * of it afterwards, and a later save is what makes the change stick.
   */
  initialRecord?: ReconstitutionRecord | null;
  /** The medication's saved dose, so the third field is filled in too. */
  initialDose?: { amount: number; unit: ReconstitutionUnit } | null;
  /** Offered as "Use these numbers" when the caller can absorb them into a form. */
  onApply?: (applied: ReconstitutionApplied) => void;
}) {
  const { t } = useTranslation();
  const [vialAmount, setVialAmount] = useState(
    initialRecord ? String(initialRecord.vial_amount) : ''
  );
  const [vialUnit, setVialUnit] = useState<ReconstitutionUnit>(
    initialRecord?.vial_unit ?? 'mg'
  );
  const [diluentMl, setDiluentMl] = useState(
    initialRecord ? String(initialRecord.diluent_ml) : ''
  );
  const [doseAmount, setDoseAmount] = useState(
    initialDose ? String(initialDose.amount) : ''
  );
  const [doseUnit, setDoseUnit] = useState<ReconstitutionUnit>(
    initialDose?.unit ?? 'mg'
  );
  const [syringe, setSyringe] = useState<SyringeStandard>(
    initialRecord?.syringe ?? 'U-100'
  );
  const [diluent, setDiluent] = useState<ReconstitutionDiluent>(
    initialRecord?.diluent ?? DEFAULT_DILUENT
  );

  // Literal keys rather than one interpolated `medications.recon.diluents.${option}`: the
  // translation-coverage test scans for keys statically, and a computed one is invisible to it.
  const diluentLabel = (option: ReconstitutionDiluent) => {
    switch (option) {
      case 'bacteriostatic_water':
        return t(
          'medications.recon.diluents.bacteriostaticWater',
          'Bacteriostatic water'
        );
      case 'bacteriostatic_saline':
        return t(
          'medications.recon.diluents.bacteriostaticSaline',
          'Bacteriostatic 0.9% sodium chloride'
        );
      case 'sterile_water':
        return t(
          'medications.recon.diluents.sterileWater',
          'Sterile water (preservative-free)'
        );
      case 'sterile_saline':
        return t(
          'medications.recon.diluents.sterileSaline',
          'Sterile 0.9% sodium chloride (preservative-free)'
        );
    }
  };

  // Blank inputs are "not filled in yet", not zero: showing a refusal before the user has
  // typed anything would be shouting at them for a mistake they have not made. Only once all
  // three are non-empty does the calculator have an opinion.
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
  }, [
    complete,
    vialAmount,
    vialUnit,
    diluentMl,
    doseAmount,
    doseUnit,
    syringe,
    intervalDays,
  ]);

  return (
    <div className="space-y-4 rounded-md border p-3 bg-muted/20">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Syringe className="h-4 w-4" />
        {t('medications.recon.title', 'Reconstitution calculator')}
      </div>

      {vialSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('medications.recon.commonVials', 'Common vials:')}
          </span>
          {vialSuggestions.map((vial) => (
            <Button
              key={`${vial.amount}-${vial.unit}`}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => {
                setVialAmount(String(vial.amount));
                setVialUnit(vial.unit);
              }}
            >
              {vial.amount} {vial.unit}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="recon-vial">
            {t('medications.recon.vial', 'Vial contains')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="recon-vial"
              type="number"
              inputMode="decimal"
              min="0"
              value={vialAmount}
              onChange={(e) => setVialAmount(e.target.value)}
              placeholder="10"
            />
            <Select
              value={vialUnit}
              onValueChange={(v) => setVialUnit(v as ReconstitutionUnit)}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit === 'iu' ? 'IU' : unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-diluent">
            {t('medications.recon.diluent', 'Diluent (mL)')}
          </Label>
          <Input
            id="recon-diluent"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={diluentMl}
            onChange={(e) => setDiluentMl(e.target.value)}
            placeholder="2"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-diluent-type">
            {t('medications.recon.diluentType', 'Diluted with')}
          </Label>
          <Select
            value={diluent}
            onValueChange={(v) => setDiluent(v as ReconstitutionDiluent)}
          >
            <SelectTrigger id="recon-diluent-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DILUENTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {diluentLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Only the preserved diluents buy a multi-day window, and the inventory form's
              beyond-use date is derived from this answer — so it is worth one line here
              rather than a surprise on the other screen. */}
          <p className="text-[11px] text-muted-foreground">
            {t(
              'medications.recon.diluentHint',
              'Bacteriostatic fluids contain a preservative; sterile ones do not, and a mix made with them has no multi-day beyond-use window.'
            )}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-dose">
            {t('medications.recon.dose', 'Your dose')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="recon-dose"
              type="number"
              inputMode="decimal"
              min="0"
              value={doseAmount}
              onChange={(e) => setDoseAmount(e.target.value)}
              placeholder="2"
            />
            <Select
              value={doseUnit}
              onValueChange={(v) => setDoseUnit(v as ReconstitutionUnit)}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit === 'iu' ? 'IU' : unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-syringe">
            {t('medications.recon.syringe', 'Syringe')}
          </Label>
          <Select
            value={syringe}
            onValueChange={(v) => setSyringe(v as SyringeStandard)}
          >
            <SelectTrigger id="recon-syringe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYRINGES.map((standard) => (
                <SelectItem key={standard} value={standard}>
                  {standard} ({SYRINGE_UNITS_PER_ML[standard]}{' '}
                  {t('medications.recon.unitsPerMl', 'units/mL')})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {result && !result.ok && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{reconstitutionFailureMessage(t, result)}</span>
        </p>
      )}

      {result?.ok && (
        <div className="space-y-3">
          {/* The syringe stands beside its numbers rather than above them: upright is how it is
              held, and a tall barrel next to a short stack of figures uses the width this form
              already has. Below `sm` there is no width to spare, so it stacks. */}
          <div className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-stretch">
            <div className="h-48 shrink-0 self-center sm:self-stretch">
              <SyringeDiagram
                units={result.syringeUnits}
                syringe={result.syringe}
                capacityUnits={result.syringeCapacityUnits}
                orientation="vertical"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p
                data-testid="recon-units"
                className="text-2xl font-bold tabular-nums"
              >
                {result.syringeUnits}{' '}
                <span className="text-base font-medium text-muted-foreground">
                  {t('medications.recon.units', 'units')} ({result.syringe})
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  'medications.recon.detail',
                  '{{concentration}} {{unit}}/mL · draw {{volume}} mL · {{doses}} doses per vial',
                  {
                    concentration: result.concentration,
                    unit:
                      result.concentrationUnit === 'iu'
                        ? 'IU'
                        : result.concentrationUnit,
                    volume: result.drawVolumeMl,
                    doses: result.dosesPerVial,
                  }
                )}
              </p>
              {result.vialLastsDays != null && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'medications.recon.lasts',
                    'Vial lasts about {{days}} days',
                    {
                      days: result.vialLastsDays,
                    }
                  )}
                </p>
              )}
            </div>
          </div>

          {result.warnings.map((warning) => (
            <p
              key={warning.code}
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{reconstitutionWarningMessage(t, warning)}</span>
            </p>
          ))}

          {onApply && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                onApply({
                  concentration: result.concentration,
                  concentrationUnit: result.concentrationUnit,
                  doseAmount: Number(doseAmount),
                  doseUnit,
                  record: {
                    vial_amount: Number(vialAmount),
                    vial_unit: vialUnit,
                    diluent_ml: Number(diluentMl),
                    syringe,
                    diluent,
                  },
                })
              }
            >
              {t('medications.recon.apply', 'Use these numbers')}
            </Button>
          )}
        </div>
      )}

      {/* Adjacent, not buried: whatever else is on screen, the framing sits with the number. */}
      <p className="text-xs text-muted-foreground">
        {t(
          'medications.recon.framing',
          'This converts the numbers you entered. It does not recommend a dose — check it against your own supply and your prescriber.'
        )}
      </p>
    </div>
  );
}
