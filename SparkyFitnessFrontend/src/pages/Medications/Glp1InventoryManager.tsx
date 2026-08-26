import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import {
  todayInZone,
  addDays,
  vialInventoryPrefill,
  PRESERVED_BUD_DAYS,
  type VialBudGuidance,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useMedicationPens,
  useCreatePenMutation,
  useUpdatePenMutation,
  useDeletePenMutation,
} from '@/hooks/useMedications';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { Medication, MedicationPen } from '@/types/medications';

/**
 * What a pen or vial holds when nothing better is known. These are the numbers the form has
 * always opened on; they stay as the fallback for a medication with no mix on record, and are
 * named here so it is obvious they are guesses rather than facts about this drug.
 */
const DEFAULT_PEN_DOSES = '4';
const DEFAULT_VIAL_DOSES = '10';

/**
 * The beyond-use window for a pen, which is not reconstituted and so has no diluent to read.
 * A vial's window is derived from its mix instead — see `budGuidance` below.
 */
const PEN_BUD_GUIDANCE: VialBudGuidance = {
  days: PRESERVED_BUD_DAYS,
  reason: 'unstated',
};

interface Glp1InventoryManagerProps {
  med: Medication;
}

export default function Glp1InventoryManager({
  med,
}: Glp1InventoryManagerProps) {
  const { t } = useTranslation();
  const medId = med.id;

  const pensQ = useMedicationPens(medId);
  const addPenMutation = useCreatePenMutation(medId);
  const updatePenMutation = useUpdatePenMutation(medId);
  const deletePenMutation = useDeletePenMutation(medId);

  // Add/Edit Inventory Form States
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [editingPen, setEditingPen] = useState<MedicationPen | null>(null);
  const [kind, setKind] = useState<'pen' | 'vial'>('pen');
  const [label, setLabel] = useState('');
  const [inventoryDoseMg, setInventoryDoseMg] = useState(
    med.dose_amount != null ? String(med.dose_amount) : ''
  );
  const [concentration, setConcentration] = useState('');
  const [volume, setVolume] = useState('');
  const [dosesTotal, setDosesTotal] = useState(DEFAULT_PEN_DOSES);
  const [openedAt, setOpenedAt] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [budDate, setBudDate] = useState('');
  // Once the user has a BUD of their own — typed here, or already saved on the row — the
  // opened date stops rewriting it. Silently recomputing over a date someone set by hand is
  // how a shorter, deliberate window gets replaced by the generous default.
  const [budTouched, setBudTouched] = useState(false);
  const [reorderFlag, setReorderFlag] = useState(false);
  const [reorderThreshold, setReorderThreshold] = useState('1');
  const [notes, setNotes] = useState('');

  const preferencesContext = usePreferences();
  const timezone =
    preferencesContext?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInZone(timezone);

  // What the medication already knows about its own vial. A reconstituted peptide carries the
  // vial size, the diluent and the syringe it was mixed with, which is exactly the arithmetic
  // this form was making the user redo by hand — see `vialInventoryPrefill`.
  const vialPrefill = useMemo(
    () =>
      vialInventoryPrefill({
        customFields: med.custom_fields,
        doseAmount: med.dose_amount,
        doseUnit: med.dose_unit,
      }),
    [med.custom_fields, med.dose_amount, med.dose_unit]
  );

  // A vial's window follows from what it was mixed with; a pen has no mix to read.
  const budGuidance = vialPrefill?.bud ?? PEN_BUD_GUIDANCE;

  /**
   * The BUD to suggest for a given opened date, or '' when none can be offered — either because
   * nothing has been opened yet, or because the diluent carries no preservative and so has no
   * multi-day window to suggest. An empty box the user fills in is the honest answer there.
   */
  const suggestBudDate = (opened: string) => {
    if (!opened || budGuidance.days === null) return '';
    try {
      return addDays(opened, budGuidance.days);
    } catch {
      return '';
    }
  };

  const handleOpenedAtChange = (next: string) => {
    setOpenedAt(next);
    if (!budTouched) setBudDate(suggestBudDate(next));
  };

  const getExpiryStatus = (
    targetDateStr: string | null,
    currentDateStr: string
  ) => {
    if (!targetDateStr) return null;
    try {
      const target = new Date(targetDateStr + 'T00:00:00');
      const current = new Date(currentDateStr + 'T00:00:00');
      const diffDays =
        (target.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays < 0) return 'expired';
      if (diffDays <= 7) return 'near';
      return 'good';
    } catch {
      return null;
    }
  };

  /**
   * Fill the vial-only fields from the medication's own mix, or leave them on the old constants
   * when there is nothing on record. `null` on a prefilled field is deliberate rather than a
   * fallback: an IU vial has no mg/mL, and a vial whose dose does not divide it has no dose
   * count, and inventing either is worse than an empty box the user fills in.
   */
  const applyVialFields = () => {
    if (vialPrefill === null) {
      // Nothing on record, so the old constants are all there is to open on.
      setConcentration('');
      setVolume('');
      setDosesTotal(DEFAULT_VIAL_DOSES);
      return;
    }
    setConcentration(
      vialPrefill.concentrationMgMl != null
        ? String(vialPrefill.concentrationMgMl)
        : ''
    );
    setVolume(String(vialPrefill.volumeMl));
    // A refused dose count leaves an empty box, not the constant. `doses_total` is what the
    // run-out date is computed from, and a 10 sitting on a vial whose mix we *have* measured
    // reads as derived when it is a guess — which is the failure this prefill exists to end.
    setDosesTotal(
      vialPrefill.dosesTotal != null ? String(vialPrefill.dosesTotal) : ''
    );
  };

  const resetForm = () => {
    setEditingPen(null);
    // A medication with a mix on record is a vial, so the form opens on the kind it is about to
    // fill in rather than making the user switch before the prefill can appear.
    const startAsVial = vialPrefill !== null;
    setKind(startAsVial ? 'vial' : 'pen');
    setLabel('');
    setInventoryDoseMg(med.dose_amount != null ? String(med.dose_amount) : '');
    if (startAsVial) {
      applyVialFields();
    } else {
      setConcentration('');
      setVolume('');
      setDosesTotal(DEFAULT_PEN_DOSES);
    }
    setOpenedAt('');
    setExpiryDate('');
    setBudDate('');
    setBudTouched(false);
    setReorderFlag(false);
    setReorderThreshold('1');
    setNotes('');
  };

  const openAddDialog = () => {
    resetForm();
    setInventoryOpen(true);
  };

  const openEditDialog = (pen: MedicationPen) => {
    setEditingPen(pen);
    setKind(pen.kind);
    setLabel(pen.label ?? '');
    setInventoryDoseMg(pen.dose_mg != null ? String(pen.dose_mg) : '');
    setConcentration(
      pen.concentration_mg_ml != null ? String(pen.concentration_mg_ml) : ''
    );
    setVolume(pen.volume_ml != null ? String(pen.volume_ml) : '');
    setDosesTotal(pen.doses_total != null ? String(pen.doses_total) : '');
    setOpenedAt(pen.opened_at ?? '');
    setExpiryDate(pen.expiry_date ?? '');
    setBudDate(pen.bud_date ?? '');
    // A stored BUD is already someone's answer; only a row without one is still open to the
    // suggestion.
    setBudTouched(pen.bud_date != null);
    setReorderFlag(pen.reorder_flag);
    setReorderThreshold(
      pen.reorder_threshold != null ? String(pen.reorder_threshold) : '1'
    );
    setNotes(pen.notes ?? '');
    setInventoryOpen(true);
  };

  const handleSaveInventory = () => {
    const body = {
      kind,
      label: label.trim() || null,
      dose_mg: inventoryDoseMg ? Number(inventoryDoseMg) : null,
      concentration_mg_ml:
        kind === 'vial' && concentration ? Number(concentration) : null,
      volume_ml: kind === 'vial' && volume ? Number(volume) : null,
      doses_total: dosesTotal ? Number(dosesTotal) : null,
      opened_at: openedAt || null,
      expiry_date: expiryDate || null,
      bud_date: budDate || null,
      reorder_flag: reorderFlag,
      reorder_threshold:
        reorderFlag && reorderThreshold ? Number(reorderThreshold) : null,
      notes: notes.trim() || null,
    } as Partial<MedicationPen>;

    const onSuccess = () => {
      setInventoryOpen(false);
      resetForm();
    };

    if (editingPen) {
      // Preserve the pen's lifecycle status on edit, except sealed -> in_use
      // when an opened date is first set.
      if (editingPen.status === 'sealed' && openedAt) {
        body.status = 'in_use';
      }
      updatePenMutation.mutate({ id: editingPen.id, body }, { onSuccess });
    } else {
      body.status = openedAt ? 'in_use' : 'sealed';
      addPenMutation.mutate(body, { onSuccess });
    }
  };

  const savePending = addPenMutation.isPending || updatePenMutation.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>
              {t('medications.glp1.penInventory', 'Pen / vial inventory')}
            </span>
            <Button variant="outline" size="sm" onClick={openAddDialog}>
              {t('medications.glp1.addInventory', 'Add Inventory')}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(pensQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('medications.glp1.noPens', 'No pens/vials tracked.')}
            </p>
          )}
          {(pensQ.data ?? []).map((p) => {
            const total = p.doses_total ?? 0;
            const left = Math.max(0, total - p.doses_used);
            const pct = total > 0 ? Math.round((left / total) * 100) : 0;
            const low = total > 0 && pct <= 25;
            const expStatus = getExpiryStatus(p.expiry_date, today);
            const budStatus = getExpiryStatus(p.bud_date, today);

            return (
              <div key={p.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {p.kind === 'vial'
                        ? t('medications.glp1.inv.kindVial', 'Vial')
                        : t('medications.glp1.inv.kindPen', 'Pen')}
                    </span>
                    {p.label && (
                      <span className="text-muted-foreground">({p.label})</span>
                    )}
                    {p.dose_mg ? (
                      <span className="text-muted-foreground">
                        {p.dose_mg} mg
                      </span>
                    ) : null}
                    {p.concentration_mg_ml ? (
                      <span className="text-muted-foreground">
                        · {p.concentration_mg_ml} mg/mL
                      </span>
                    ) : null}
                    {p.status === 'in_use' && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('medications.glp1.inv.inUse', 'in use')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.reorder_flag &&
                      p.reorder_threshold != null &&
                      left <= p.reorder_threshold && (
                        <Badge
                          variant="destructive"
                          className="flex items-center gap-1 text-[10px]"
                        >
                          <AlertTriangle className="h-3 w-3" />{' '}
                          {t('medications.glp1.inv.reorder', 'Reorder')}
                        </Badge>
                      )}
                    <span className="font-medium tabular-nums">
                      {left}/{total || '?'}{' '}
                      <span className="font-normal text-muted-foreground">
                        {t('medications.glp1.inv.doses', 'doses')}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => openEditDialog(p)}
                      aria-label={t(
                        'medications.glp1.inv.editAria',
                        'Edit pen/vial'
                      )}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deletePenMutation.mutate(p.id)}
                      disabled={deletePenMutation.isPending}
                      aria-label={t(
                        'medications.glp1.inv.removeAria',
                        'Remove pen/vial'
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${low ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {(p.expiry_date || p.bud_date) && (
                  <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground flex-wrap items-center">
                    {p.expiry_date && (
                      <span className="flex items-center gap-1">
                        {t('medications.glp1.inv.expiry', 'Exp {{date}}', {
                          date: p.expiry_date,
                        })}
                        {expStatus === 'expired' && (
                          <Badge
                            variant="destructive"
                            className="text-[9px] px-1 py-0 h-4"
                          >
                            {t('medications.glp1.inv.expired', 'Expired')}
                          </Badge>
                        )}
                        {expStatus === 'near' && (
                          <Badge className="text-[9px] px-1 py-0 h-4 bg-amber-500 text-white hover:bg-amber-600">
                            {t('medications.glp1.inv.nearExpiry', 'Near Exp')}
                          </Badge>
                        )}
                      </span>
                    )}
                    {p.bud_date && (
                      <span className="flex items-center gap-1">
                        {t('medications.glp1.inv.bud', 'BUD {{date}}', {
                          date: p.bud_date,
                        })}
                        {budStatus === 'expired' && (
                          <Badge
                            variant="destructive"
                            className="text-[9px] px-1 py-0 h-4"
                          >
                            {t(
                              'medications.glp1.inv.budExpired',
                              'Expired (BUD)'
                            )}
                          </Badge>
                        )}
                        {budStatus === 'near' && (
                          <Badge className="text-[9px] px-1 py-0 h-4 bg-amber-500 text-white hover:bg-amber-600 font-semibold">
                            {t(
                              'medications.glp1.inv.budWarning',
                              'BUD Warning'
                            )}
                          </Badge>
                        )}
                      </span>
                    )}
                  </div>
                )}
                {p.notes && (
                  <p className="mt-1.5 text-xs text-muted-foreground italic border-t pt-1">
                    {t('medications.glp1.inv.notesLine', 'Notes: {{notes}}', {
                      notes: p.notes,
                    })}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Add/Edit Inventory Dialog */}
      <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPen
                ? t(
                    'medications.glp1.inv.editTitle',
                    'Edit Pen / Vial Inventory'
                  )
                : t(
                    'medications.glp1.inv.addTitle',
                    'Add Pen / Vial Inventory'
                  )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-kind">
                  {t('medications.glp1.inv.kind', 'Kind')}
                </Label>
                <Select
                  value={kind}
                  onValueChange={(v) => {
                    const next = v as 'pen' | 'vial';
                    setKind(next);
                    if (next === 'pen') {
                      setDosesTotal(DEFAULT_PEN_DOSES);
                    } else {
                      applyVialFields();
                    }
                  }}
                >
                  <SelectTrigger id="inv-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pen">
                      {t('medications.glp1.inv.kindPen', 'Pen')}
                    </SelectItem>
                    <SelectItem value="vial">
                      {t('medications.glp1.inv.kindVial', 'Vial')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="inv-label">
                  {t('medications.glp1.inv.label', 'Label / Name')}
                </Label>
                <Input
                  id="inv-label"
                  placeholder={t(
                    'medications.glp1.inv.labelPlaceholder',
                    'e.g. Pen #2, Vial Batch A'
                  )}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-dose">
                  {t('medications.glp1.inv.doseStrength', 'Dose Strength (mg)')}
                </Label>
                <Input
                  id="inv-dose"
                  type="number"
                  step="0.05"
                  value={inventoryDoseMg}
                  onChange={(e) => setInventoryDoseMg(e.target.value)}
                  placeholder={
                    med.dose_amount != null ? String(med.dose_amount) : '0'
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="inv-doses-total">
                  {t('medications.glp1.inv.totalDoses', 'Total Doses')}
                </Label>
                <Input
                  id="inv-doses-total"
                  type="number"
                  value={dosesTotal}
                  onChange={(e) => setDosesTotal(e.target.value)}
                />
              </div>
            </div>

            {kind === 'vial' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="inv-concentration">
                    {t(
                      'medications.glp1.inv.concentration',
                      'Concentration (mg/mL)'
                    )}
                  </Label>
                  <Input
                    id="inv-concentration"
                    type="number"
                    step="0.1"
                    placeholder={t(
                      'medications.glp1.inv.concentrationPlaceholder',
                      'e.g. 5'
                    )}
                    value={concentration}
                    onChange={(e) => setConcentration(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inv-volume">
                    {t('medications.glp1.inv.volume', 'Volume (mL)')}
                  </Label>
                  <Input
                    id="inv-volume"
                    type="number"
                    step="0.1"
                    placeholder={t(
                      'medications.glp1.inv.volumePlaceholder',
                      'e.g. 2'
                    )}
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-opened">
                  {t('medications.glp1.inv.dateOpened', 'Date Opened')}
                </Label>
                <Input
                  id="inv-opened"
                  type="date"
                  value={openedAt}
                  onChange={(e) => handleOpenedAtChange(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="inv-expiry">
                  {t('medications.glp1.inv.expiryDate', 'Expiry Date')}
                </Label>
                <Input
                  id="inv-expiry"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>

            {openedAt && (
              <div className="space-y-1">
                <Label htmlFor="inv-bud">
                  {t('medications.glp1.inv.budLabel', 'Beyond-Use Date (BUD)')}
                </Label>
                <Input
                  id="inv-bud"
                  type="date"
                  value={budDate}
                  onChange={(e) => {
                    setBudDate(e.target.value);
                    setBudTouched(true);
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {budGuidance.reason === 'preservative_free'
                    ? t(
                        'medications.glp1.inv.budPreservativeFree',
                        'This mix was made with a preservative-free diluent, so there is no multi-day window to suggest. Set a date from your own supply and storage.'
                      )
                    : budGuidance.reason === 'preserved'
                      ? t(
                          'medications.glp1.inv.budPreserved',
                          'Suggested as {{days}} days from opening, from the preserved diluent recorded for this mix, kept refrigerated.',
                          { days: budGuidance.days }
                        )
                      : t(
                          'medications.glp1.inv.budUnstated',
                          'Suggested as {{days}} days from opening. This mix does not record what it was diluted with, so that figure assumes a preserved diluent — edit the date if it was not.',
                          { days: budGuidance.days }
                        )}
                </p>
              </div>
            )}

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="inv-reorder" className="flex flex-col gap-0.5">
                  <span>
                    {t(
                      'medications.glp1.inv.reorderToggle',
                      'Enable Reorder Warning'
                    )}
                  </span>
                  <span className="font-normal text-[10px] text-muted-foreground">
                    {t(
                      'medications.glp1.inv.reorderHint',
                      'Alert when remaining doses are low'
                    )}
                  </span>
                </Label>
                <Switch
                  id="inv-reorder"
                  checked={reorderFlag}
                  onCheckedChange={setReorderFlag}
                />
              </div>

              {reorderFlag && (
                <div className="space-y-1 pt-1">
                  <Label htmlFor="inv-threshold">
                    {t(
                      'medications.glp1.inv.reorderThreshold',
                      'Reorder Threshold (doses left)'
                    )}
                  </Label>
                  <Input
                    id="inv-threshold"
                    type="number"
                    value={reorderThreshold}
                    onChange={(e) => setReorderThreshold(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="inv-notes">
                {t('medications.glp1.inv.notes', 'Notes')}
              </Label>
              <Textarea
                id="inv-notes"
                placeholder={t(
                  'medications.glp1.inv.notesPlaceholder',
                  'Batch number, brand, pharmacy info...'
                )}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInventoryOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSaveInventory} disabled={savePending}>
              {savePending
                ? t('common.saving', 'Saving...')
                : editingPen
                  ? t('common.saveChanges', 'Save Changes')
                  : t('medications.glp1.addInventory', 'Add Inventory')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
