import { tool } from 'ai';
import { todayInZone } from '@workspace/shared';
import { log } from '../../config/logging.js';
import medicationRepository from '../../models/medicationRepository.js';
import type {
  CreateMedicationBody,
  UpdateMedicationBody,
  CreateScheduleBody,
  UpdateScheduleBody,
} from '../../schemas/medicationSchemas.js';
import medicationEntryRepository from '../../models/medicationEntryRepository.js';
import injectionRepository from '../../models/injectionRepository.js';
import symptomRepository from '../../models/symptomRepository.js';
import type { CreateSymptomEntryBody } from '../../schemas/symptomSchemas.js';
import { ERRORS, formatZodError } from './errors.js';
import {
  DAY_NAMES,
  dayString,
  formatConfirmation,
  formatList,
} from './formatting.js';
import { normalizeActionArgs } from './dates.js';
import {
  manageMedicationsSchema,
  manageMedicationsInput,
  type ManageMedicationsInput,
} from './schemas/medications.js';

interface MedicationSummary {
  id: string;
  display_name: string | null;
  name: string;
}

interface ScheduleSummary {
  time_of_day: string | null;
}

interface MedicationRow {
  id: string;
  display_name: string | null;
  name: string;
  strength_value: number | null;
  strength_unit: string | null;
  is_active: boolean;
  schedules: ScheduleSummary[];
}

interface MedicationDetailRow extends MedicationRow {
  dose_amount: number | null;
  dose_unit: string | null;
  is_glp1: boolean;
  reason_text: string | null;
  notes: string | null;
  schedules: {
    time_of_day: string | null;
    active: boolean | null;
    dose_amount: number | null;
    prn_reason: string | null;
  }[];
}

interface MedicationEntryRow {
  status: string;
  med_name_snapshot: string | null;
  entry_date: string;
  dose_amount_snapshot: number | null;
  dose_unit_snapshot: string | null;
  notes: string | null;
  entry_type: string | null;
}

interface InjectionRow {
  entry_date: string;
  dose_mg: number | null;
  site: string | null;
  notes: string | null;
}

interface InjectionWithPenRow extends InjectionRow {
  pen: {
    doses_used: number;
    doses_total: number | null;
  } | null;
}

interface PreProcessedArgs {
  action?: string;
  entry_date?: string;
  date?: string;
  dosage?: number;
  dosage_unit?: string;
  dose_amount_snapshot?: number;
  dose_unit_snapshot?: string;
  medication_id?: string;
  medication_name?: string;
  status?: string;
  taken_at?: string;
  notes?: string | null;
  glp1_only?: boolean;
  active_only?: boolean;
  from_date?: string;
  to_date?: string;
  dose_mg?: number;
  site?: string;
  deduct_pen?: boolean;
  entry_id?: string;
  name?: string;
  new_name?: string;
  schedule_id?: string;
  schedule_type_id?: string;
  time_of_day?: string;
  days_of_week?: number[];
  interval_days?: number;
  day_of_month?: number;
  cycle_on_days?: number;
  cycle_off_days?: number;
  with_meal?: string;
  prn_reason?: string;
  prn_max_per_day?: number;
  start_date?: string;
  end_date?: string;
  active?: boolean;
  display_name?: string;
  strength_value?: number;
  strength_unit?: string;
  dose_amount?: number;
  dose_unit?: string;
  reason_text?: string;
  is_active?: boolean;
  is_glp1?: boolean;
  is_supplement?: boolean;
  symptom_name?: string;
  severity?: number;
  severity_label?: string;
  body_location?: string;
  context_text?: string;
  bristol_type?: number;
}

const VALID_ACTIONS = [
  'list_medications',
  'get_medication',
  'log',
  'list_entries',
  'update_entry',
  'delete_entry',
  'log_injection',
  'list_injections',
  'create_medication',
  'update_medication',
  'add_schedule',
  'update_schedule',
  'delete_schedule',
  'list_schedules',
  'log_symptom',
  'list_symptoms',
  'list_symptom_entries',
];

async function resolveMedicationId(
  userId: string,
  nameOrId: string | undefined
): Promise<{ id: string } | { error: string } | null> {
  if (!nameOrId) return null;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(nameOrId)) return { id: nameOrId };
  const meds: MedicationSummary[] = await medicationRepository.listMedications(
    userId,
    {}
  );
  const q = nameOrId.trim().toLowerCase();
  const matches = meds.filter(
    (m) => (m.display_name || m.name).toLowerCase() === q
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return {
      error: `Multiple medications are named "${nameOrId}" — use medication_id (see list_medications)`,
    };
  }
  return { id: matches[0].id };
}

// A schedule missing its type-specific fields would insert fine but never
// come due (isScheduleDueOnDate returns false), so require them up front.
function validateScheduleFields(
  typeId: string,
  fields: {
    days_of_week?: number[] | null;
    interval_days?: number | null;
    day_of_month?: number | null;
    cycle_on_days?: number | null;
    start_date?: string | null;
    end_date?: string | null;
  }
): string | null {
  if (
    (typeId === 'specific_days' || typeId === 'weekly') &&
    !fields.days_of_week?.length
  ) {
    return `A ${typeId} schedule needs days_of_week (0=Sunday … 6=Saturday) — without it the schedule would never come due`;
  }
  if (typeId === 'every_n_days' && !fields.interval_days) {
    return 'An every_n_days schedule needs interval_days — without it the schedule would never come due';
  }
  if (typeId === 'monthly' && !fields.day_of_month) {
    return 'A monthly schedule needs day_of_month — without it the schedule would never come due';
  }
  if (typeId === 'cyclic' && !fields.cycle_on_days) {
    return 'A cyclic schedule needs cycle_on_days — without it the schedule would never come due';
  }
  // Without an anchor the shared due-date evaluator counts from a fixed
  // 2020-01-01 epoch, making the due days arbitrary.
  if (
    (typeId === 'every_n_days' || typeId === 'cyclic') &&
    !fields.start_date
  ) {
    return `A ${typeId} schedule needs start_date — the repeat cycle is counted from it`;
  }
  if (
    fields.start_date &&
    fields.end_date &&
    fields.end_date < fields.start_date
  ) {
    return 'end_date must be on or after start_date';
  }
  return null;
}

interface ScheduleRow {
  id: string;
  medication_id: string;
  schedule_type_id: string;
  time_of_day: string | null;
  dose_amount: number | null;
  days_of_week: number[] | null;
  interval_days: number | null;
  day_of_month: number | null;
  cycle_on_days: number | null;
  cycle_off_days: number | null;
  with_meal: string | null;
  prn_reason: string | null;
  prn_max_per_day: number | null;
  start_date: unknown;
  end_date: unknown;
  active: boolean | null;
}

function describeSchedule(s: ScheduleRow): string {
  const parts: string[] = [s.schedule_type_id];
  if (s.days_of_week?.length) {
    parts.push(`on ${s.days_of_week.map((d) => DAY_NAMES[d]).join(', ')}`);
  }
  if (s.interval_days) parts.push(`every ${s.interval_days} days`);
  if (s.day_of_month) parts.push(`on day ${s.day_of_month} of the month`);
  if (s.cycle_on_days) {
    parts.push(
      `${s.cycle_on_days} days on / ${s.cycle_off_days ?? 0} days off`
    );
  }
  if (s.time_of_day) parts.push(`at ${s.time_of_day}`);
  if (s.with_meal) parts.push(`(${s.with_meal.replace(/_/g, ' ')} meal)`);
  if (s.prn_reason) parts.push(`for ${s.prn_reason}`);
  return parts.join(' ');
}

interface CustomSymptomRow {
  id: string;
  name: string;
  display_name: string | null;
  scale_type: string;
  unit: string | null;
  is_glp1_flagged: boolean;
}

interface SymptomEntryRow {
  id: string;
  symptom_name_snapshot: string;
  severity: number | null;
  severity_label: string | null;
  entry_date: unknown;
  body_location: string | null;
  context_text: string | null;
  bristol_type: number | null;
}

// The resolver matches on display_name || name, so a collision on either
// stored field breaks name-based addressing. Candidates and stored values are
// compared trimmed and case-folded.
function medicationNameConflict(
  meds: MedicationSummary[],
  candidates: (string | undefined)[],
  excludeId?: string
): { name: string; id: string } | null {
  const wanted = candidates.filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0
  );
  for (const m of meds) {
    if (excludeId && m.id === excludeId) continue;
    const stored = [m.name, m.display_name]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.trim().toLowerCase());
    for (const candidate of wanted) {
      if (stored.includes(candidate.trim().toLowerCase())) {
        return { name: candidate, id: m.id };
      }
    }
  }
  return null;
}

// Type-specific schedule fields; cleared on a type switch so a converted
// schedule does not keep (and report) fields from its old type.
const TYPE_SPECIFIC_SCHEDULE_FIELDS = [
  'days_of_week',
  'interval_days',
  'day_of_month',
  'cycle_on_days',
  'cycle_off_days',
  'prn_reason',
  'prn_max_per_day',
] as const;

// Which type-specific fields each schedule type actually uses; anything else
// sent explicitly is rejected so a schedule cannot carry rules its due-date
// evaluator ignores (e.g. "daily on Monday").
const SCHEDULE_TYPE_FIELDS: Record<string, readonly string[]> = {
  daily: [],
  taper: [],
  specific_days: ['days_of_week'],
  weekly: ['days_of_week'],
  every_n_days: ['interval_days'],
  monthly: ['day_of_month'],
  cyclic: ['cycle_on_days', 'cycle_off_days'],
  prn: ['prn_reason', 'prn_max_per_day'],
};

function irrelevantScheduleField(
  typeId: string,
  args: Record<string, unknown>
): string | null {
  const allowed = SCHEDULE_TYPE_FIELDS[typeId] ?? [];
  for (const field of TYPE_SPECIFIC_SCHEDULE_FIELDS) {
    if (!allowed.includes(field) && args[field] !== undefined) {
      return `${field} does not apply to a ${typeId} schedule`;
    }
  }
  return null;
}

// Schedule fields forwarded verbatim from tool args to the repository.
const SCHEDULE_PATCH_FIELDS = [
  'schedule_type_id',
  'time_of_day',
  'dose_amount',
  'days_of_week',
  'interval_days',
  'day_of_month',
  'cycle_on_days',
  'cycle_off_days',
  'with_meal',
  'prn_reason',
  'prn_max_per_day',
  'start_date',
  'end_date',
  'active',
] as const;

// Medication fields forwarded verbatim from tool args to the repository.
const MEDICATION_PATCH_FIELDS = [
  'display_name',
  'strength_value',
  'strength_unit',
  'dose_amount',
  'dose_unit',
  'reason_text',
  'is_active',
  'is_glp1',
  'is_supplement',
  'notes',
] as const;

export function buildMedicationTools(userId: string, tz: string) {
  return {
    sparky_manage_medications: tool({
      description: `Medication tracking: list medications, log doses, and view history.

Actions:
- list_medications(glp1_only?, active_only?)
- get_medication(medication_id)
- log(medication_id?|medication_name?, status?, taken_at?, entry_date?, dosage?, dosage_unit?, notes?)
- list_entries(medication_id?, from_date?, to_date?)
- update_entry(entry_id, status?, taken_at?, entry_date?, notes?)
- delete_entry(entry_id)
- log_injection(medication_id?|medication_name?, dose_mg?, site?, deduct_pen?, entry_date?, notes?)
- list_injections(medication_id?, from_date?, to_date?)
- create_medication(name, display_name?, strength_value?, strength_unit?, dose_amount?, dose_unit?, reason_text?, is_active?, is_glp1?, is_supplement?, notes?)
- update_medication(medication_id?|medication_name?, new_name?, any medication field) — only provided fields change
- add_schedule(medication_id?|medication_name?, schedule_type_id, time_of_day?, days_of_week?, interval_days?, day_of_month?, cycle_on_days?, cycle_off_days?, with_meal?, prn_reason?, prn_max_per_day?, start_date?, end_date?, dose_amount?) — schedule types: daily, specific_days, every_n_days, cyclic, weekly, monthly, prn, taper
- update_schedule(schedule_id, any schedule field) — only provided fields change
- delete_schedule(schedule_id) — DESTRUCTIVE: confirm with the user (sparky_ask_user) before calling
- list_schedules(medication_id?|medication_name?) — schedules with their IDs
- log_symptom(symptom_name, severity? 1-10, severity_label?, body_location?, context_text?, bristol_type? 1-7, medication_id?|medication_name? if a medication is suspected, entry_date?)
- list_symptoms() — the user's tracked symptom definitions
- list_symptom_entries(symptom_name?, from_date?, to_date?)`,
      inputSchema: manageMedicationsInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          tz,
          VALID_ACTIONS,
          (args: Record<string, unknown>) => {
            if (args.entry_id) {
              if (
                args.status !== undefined ||
                args.taken_at !== undefined ||
                args.entry_date !== undefined ||
                args.notes !== undefined
              ) {
                return 'update_entry';
              }
              return 'delete_entry';
            }
            if (args.symptom_name) {
              return args.from_date || args.to_date
                ? 'list_symptom_entries'
                : 'log_symptom';
            }
            // delete_schedule is destructive and is never inferred.
            if (args.schedule_id) {
              return 'update_schedule';
            }
            if (args.schedule_type_id) {
              return 'add_schedule';
            }
            if (args.name) {
              return args.medication_id || args.medication_name
                ? 'update_medication'
                : 'create_medication';
            }
            // notes is deliberately absent: medication_name + notes is a
            // dose log, not a medication edit.
            if (
              args.new_name ||
              args.display_name !== undefined ||
              args.strength_value !== undefined ||
              args.strength_unit !== undefined ||
              args.dose_amount !== undefined ||
              args.dose_unit !== undefined ||
              args.reason_text !== undefined ||
              args.is_active !== undefined ||
              args.is_supplement !== undefined ||
              args.is_glp1 !== undefined
            ) {
              return 'update_medication';
            }
            if (args.site || args.dose_mg || args.deduct_pen !== undefined) {
              return 'log_injection';
            }
            if (args.medication_name || args.dosage !== undefined) return 'log';
            if (args.status) return 'log';
            if (args.medication_id) {
              if (args.from_date || args.to_date) return 'list_entries';
              return 'get_medication';
            }
            if (args.from_date || args.to_date) return 'list_injections';
            if (
              args.glp1_only !== undefined ||
              args.active_only !== undefined
            ) {
              return 'list_medications';
            }
            return 'list_medications';
          }
        ) as PreProcessedArgs;

        if (normalized.date && !normalized.entry_date) {
          normalized.entry_date = normalized.date;
        }
        delete normalized.date;

        if (
          normalized.dosage !== undefined &&
          normalized.dose_amount_snapshot === undefined
        ) {
          normalized.dose_amount_snapshot = normalized.dosage;
        }
        delete normalized.dosage;

        if (normalized.dosage_unit && !normalized.dose_unit_snapshot) {
          normalized.dose_unit_snapshot = normalized.dosage_unit;
        }
        delete normalized.dosage_unit;

        if (normalized.medication_name && !normalized.medication_id) {
          const resolved = await resolveMedicationId(
            userId,
            normalized.medication_name
          );
          if (!resolved) {
            return ERRORS.VALIDATION(
              `Medication "${normalized.medication_name}" not found.`
            );
          }
          if ('error' in resolved) {
            return ERRORS.VALIDATION(resolved.error);
          }
          normalized.medication_id = resolved.id;
          delete normalized.medication_name;
        }

        const parsed = manageMedicationsSchema.safeParse(normalized);
        if (!parsed.success) return formatZodError(parsed.error);
        const args: ManageMedicationsInput = parsed.data;
        try {
          switch (args.action) {
            case 'list_medications': {
              const meds: MedicationRow[] =
                await medicationRepository.listMedications(userId, {
                  glp1Only: args.glp1_only,
                  activeOnly: args.active_only,
                });
              return formatList(meds, 'Medications', (m) => {
                let text = `**${m.display_name || m.name}**`;
                if (m.strength_value && m.strength_unit) {
                  text += ` — ${m.strength_value}${m.strength_unit}`;
                }
                if (!m.is_active) text += ' (inactive)';
                text += `\n  ID: ${m.id}`;
                const schedules = m.schedules || [];
                if (schedules.length > 0) {
                  const times = schedules
                    .map((s) => s.time_of_day || 'as needed')
                    .join(', ');
                  text += `\n  Schedules: ${times}`;
                }
                return text;
              });
            }
            case 'get_medication': {
              const med: MedicationDetailRow | null =
                await medicationRepository.getMedicationById(
                  userId,
                  args.medication_id
                );
              if (!med)
                return ERRORS.NOT_FOUND('Medication', args.medication_id);
              let text = `**${med.display_name || med.name}**`;
              if (med.strength_value && med.strength_unit) {
                text += ` — ${med.strength_value}${med.strength_unit}`;
              }
              if (med.dose_amount && med.dose_unit) {
                text += `\nDose: ${med.dose_amount} ${med.dose_unit}`;
              }
              text += `\nActive: ${med.is_active ? 'Yes' : 'No'}`;
              if (med.is_glp1) text += '\nType: GLP-1';
              if (med.reason_text) text += `\nReason: ${med.reason_text}`;
              if (med.notes) text += `\nNotes: ${med.notes}`;
              text += `\nID: ${med.id}`;
              const schedules = med.schedules || [];
              if (schedules.length > 0) {
                text += '\n\n**Schedules:**';
                for (const s of schedules) {
                  text += `\n- ${s.time_of_day || 'Any time'}`;
                  if (!s.active) text += ' (inactive)';
                  if (s.dose_amount) text += ` | ${s.dose_amount} mg`;
                  if (s.prn_reason) text += ` | PRN: ${s.prn_reason}`;
                }
              }
              return text;
            }
            case 'log': {
              if (!args.entry_date) args.entry_date = todayInZone(tz);
              if (!args.taken_at) args.taken_at = new Date().toISOString();
              const entry: MedicationEntryRow =
                await medicationEntryRepository.createEntry(userId, {
                  medication_id: args.medication_id!,
                  status: args.status,
                  taken_at: args.taken_at,
                  entry_date: args.entry_date!,
                  dose_amount_snapshot: args.dose_amount_snapshot ?? undefined,
                  dose_unit_snapshot: args.dose_unit_snapshot ?? undefined,
                  notes: args.notes ?? null,
                });
              let detail = `"${entry.status}"`;
              if (entry.dose_amount_snapshot) {
                detail += ` (${entry.dose_amount_snapshot} ${entry.dose_unit_snapshot || ''})`;
              }
              return formatConfirmation(
                `Dose logged as ${detail} for ${entry.med_name_snapshot} on ${dayString(entry.entry_date)}.`
              );
            }
            case 'list_entries': {
              const entries: MedicationEntryRow[] =
                await medicationEntryRepository.listEntriesWithInjections(
                  userId,
                  {
                    fromDate: args.from_date,
                    toDate: args.to_date,
                    medicationId: args.medication_id,
                  }
                );
              return formatList(entries, 'Medication Entries', (e) => {
                const icon =
                  e.status === 'taken'
                    ? '✅'
                    : e.status === 'skipped'
                      ? '❌'
                      : e.status === 'snoozed'
                        ? '⏰'
                        : '💊';
                let text = `${icon} ${e.med_name_snapshot || 'Unknown'} — ${e.status} on ${dayString(e.entry_date)}`;
                if (e.dose_amount_snapshot) {
                  text += ` (${e.dose_amount_snapshot} ${e.dose_unit_snapshot || ''})`;
                }
                if (e.notes) text += ` — ${e.notes}`;
                if (e.entry_type === 'injection') text += ' [injection]';
                return text;
              });
            }
            case 'update_entry': {
              const entry: MedicationEntryRow | null =
                await medicationEntryRepository.updateEntry(
                  userId,
                  args.entry_id,
                  {
                    status: args.status,
                    taken_at: args.taken_at,
                    entry_date: args.entry_date,
                    notes: args.notes !== undefined ? args.notes : undefined,
                  }
                );
              if (!entry) return ERRORS.NOT_FOUND('Entry', args.entry_id);
              return formatConfirmation(
                `Entry updated (${entry.status}) for ${entry.med_name_snapshot} on ${dayString(entry.entry_date)}.`
              );
            }
            case 'delete_entry': {
              const ok = await medicationEntryRepository.deleteEntry(
                userId,
                args.entry_id
              );
              if (!ok) return ERRORS.NOT_FOUND('Entry', args.entry_id);
              return formatConfirmation('Entry deleted.');
            }
            case 'log_injection': {
              if (!args.entry_date) args.entry_date = todayInZone(tz);
              const injection: InjectionWithPenRow =
                await injectionRepository.createInjection(userId, {
                  medication_id: args.medication_id!,
                  dose_mg: args.dose_mg,
                  site: args.site ?? null,
                  deduct_pen: args.deduct_pen,
                  entry_date: args.entry_date!,
                  notes: args.notes ?? null,
                });
              let text = `Injection logged (${injection.dose_mg} mg) for ${dayString(injection.entry_date)}.`;
              if (injection.pen) {
                text += ` Pen: ${injection.pen.doses_used}/${injection.pen.doses_total ?? '?'} doses used.`;
              }
              return formatConfirmation(text);
            }
            case 'list_injections': {
              const injections: InjectionRow[] =
                await injectionRepository.listInjections(userId, {
                  medicationId: args.medication_id,
                  fromDate: args.from_date,
                  toDate: args.to_date,
                });
              return formatList(
                injections,
                'Injections',
                (i) =>
                  `${dayString(i.entry_date)}: ${i.dose_mg} mg${i.site ? ` at ${i.site}` : ''}${i.notes ? ` — ${i.notes}` : ''}`
              );
            }
            case 'create_medication': {
              const meds: MedicationSummary[] =
                await medicationRepository.listMedications(userId, {});
              const conflict = medicationNameConflict(meds, [
                args.name,
                args.display_name,
              ]);
              if (conflict) {
                return ERRORS.VALIDATION(
                  `A medication named "${conflict.name}" already exists (medication_id ${conflict.id}) — use update_medication to change it, or choose a different name`
                );
              }
              const payload: CreateMedicationBody = { name: args.name };
              for (const field of MEDICATION_PATCH_FIELDS) {
                const value = (args as Record<string, unknown>)[field];
                if (value !== undefined) {
                  (payload as Record<string, unknown>)[field] = value;
                }
              }
              if (args.notes !== undefined && args.notes !== null) {
                payload.notes = args.notes;
              }
              const med = (await medicationRepository.createMedication(
                userId,
                payload
              )) as MedicationRow;
              return formatConfirmation(
                `Medication "${med.display_name || med.name}" created (ID: ${med.id}). Use add_schedule to set when it is taken.`
              );
            }
            case 'update_medication': {
              const medId = args.medication_id!;
              const existing = (await medicationRepository.getMedicationById(
                userId,
                medId
              )) as MedicationDetailRow | null;
              if (!existing) return ERRORS.NOT_FOUND('Medication', medId);
              const hasUpdate =
                args.new_name !== undefined ||
                args.notes !== undefined ||
                MEDICATION_PATCH_FIELDS.some(
                  (f) => (args as Record<string, unknown>)[f] !== undefined
                );
              if (!hasUpdate) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide new_name or at least one medication field'
                );
              }
              if (
                args.new_name !== undefined ||
                args.display_name !== undefined
              ) {
                const meds: MedicationSummary[] =
                  await medicationRepository.listMedications(userId, {});
                const conflict = medicationNameConflict(
                  meds,
                  [args.new_name, args.display_name],
                  existing.id
                );
                if (conflict) {
                  return ERRORS.VALIDATION(
                    `A medication named "${conflict.name}" already exists — choose a different name`
                  );
                }
              }
              const patch: UpdateMedicationBody = {};
              if (args.new_name !== undefined) patch.name = args.new_name;
              if (args.notes !== undefined) patch.notes = args.notes;
              for (const field of MEDICATION_PATCH_FIELDS) {
                const value = (args as Record<string, unknown>)[field];
                if (value !== undefined) {
                  (patch as Record<string, unknown>)[field] = value;
                }
              }
              const updated = (await medicationRepository.updateMedication(
                userId,
                medId,
                patch
              )) as MedicationRow | null;
              if (!updated) return ERRORS.NOT_FOUND('Medication', medId);
              return formatConfirmation(
                `Medication "${updated.display_name || updated.name}" updated.`
              );
            }
            case 'add_schedule': {
              const medId = args.medication_id!;
              // Verify ownership before inserting: the medication_id FK is
              // checked outside RLS, so an unverified id could attach a
              // schedule to another user's medication.
              const med = (await medicationRepository.getMedicationById(
                userId,
                medId
              )) as MedicationDetailRow | null;
              if (!med) return ERRORS.NOT_FOUND('Medication', medId);
              const irrelevant = irrelevantScheduleField(
                args.schedule_type_id,
                args as Record<string, unknown>
              );
              if (irrelevant) return ERRORS.VALIDATION(irrelevant);
              const fieldError = validateScheduleFields(
                args.schedule_type_id,
                args
              );
              if (fieldError) return ERRORS.VALIDATION(fieldError);
              const payload: CreateScheduleBody = {
                schedule_type_id: args.schedule_type_id,
              };
              for (const field of SCHEDULE_PATCH_FIELDS) {
                if (field === 'schedule_type_id') continue;
                const value = (args as Record<string, unknown>)[field];
                if (value !== undefined) {
                  (payload as Record<string, unknown>)[field] = value;
                }
              }
              const sched = (await medicationRepository.addSchedule(
                userId,
                medId,
                payload
              )) as ScheduleRow;
              return formatConfirmation(
                `Schedule added to ${med.display_name || med.name}: ${describeSchedule(sched)} (schedule_id ${sched.id}).`
              );
            }
            case 'update_schedule': {
              const meds = (await medicationRepository.listMedications(
                userId,
                {}
              )) as (MedicationSummary & { schedules?: ScheduleRow[] })[];
              let existing: ScheduleRow | undefined;
              let parent: MedicationSummary | undefined;
              for (const m of meds) {
                const match = m.schedules?.find(
                  (s) => s.id === args.schedule_id
                );
                if (match) {
                  existing = match;
                  parent = m;
                  break;
                }
              }
              if (!existing || !parent) {
                return ERRORS.NOT_FOUND('Schedule', args.schedule_id);
              }
              const hasUpdate = SCHEDULE_PATCH_FIELDS.some(
                (f) => (args as Record<string, unknown>)[f] !== undefined
              );
              if (!hasUpdate) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide at least one schedule field'
                );
              }
              // Validate the merged schedule so a type switch cannot strand
              // the row without its type-specific fields.
              const mergedType =
                args.schedule_type_id ?? existing.schedule_type_id;
              // On a type switch, type-specific fields not sent in this call
              // are cleared rather than carried, so the converted schedule
              // does not keep stale fields from its old type.
              const typeSwitched = mergedType !== existing.schedule_type_id;
              const irrelevant = irrelevantScheduleField(
                mergedType,
                args as Record<string, unknown>
              );
              if (irrelevant) return ERRORS.VALIDATION(irrelevant);
              const mergedOf = (field: keyof ScheduleRow) => {
                const value = (args as Record<string, unknown>)[field];
                if (value !== undefined) return value;
                return typeSwitched ? null : existing[field];
              };
              const fieldError = validateScheduleFields(mergedType, {
                days_of_week: mergedOf('days_of_week') as number[] | null,
                interval_days: mergedOf('interval_days') as number | null,
                day_of_month: mergedOf('day_of_month') as number | null,
                cycle_on_days: mergedOf('cycle_on_days') as number | null,
                start_date:
                  args.start_date ??
                  (existing.start_date ? dayString(existing.start_date) : null),
                end_date:
                  args.end_date ??
                  (existing.end_date ? dayString(existing.end_date) : null),
              });
              if (fieldError) return ERRORS.VALIDATION(fieldError);
              const patch: UpdateScheduleBody = {};
              for (const field of SCHEDULE_PATCH_FIELDS) {
                const value = (args as Record<string, unknown>)[field];
                if (value !== undefined) {
                  (patch as Record<string, unknown>)[field] = value;
                }
              }
              if (typeSwitched) {
                for (const field of TYPE_SPECIFIC_SCHEDULE_FIELDS) {
                  if ((args as Record<string, unknown>)[field] === undefined) {
                    (patch as Record<string, unknown>)[field] = null;
                  }
                }
              }
              const updated = (await medicationRepository.updateSchedule(
                userId,
                args.schedule_id,
                patch
              )) as ScheduleRow | null;
              if (!updated) {
                return ERRORS.NOT_FOUND('Schedule', args.schedule_id);
              }
              return formatConfirmation(
                `Schedule updated for ${parent.display_name || parent.name}: ${describeSchedule(updated)}.`
              );
            }
            case 'delete_schedule': {
              const ok = await medicationRepository.deleteSchedule(
                userId,
                args.schedule_id
              );
              if (!ok) return ERRORS.NOT_FOUND('Schedule', args.schedule_id);
              return formatConfirmation('Schedule deleted.');
            }
            case 'list_schedules': {
              const medId = args.medication_id!;
              const med = (await medicationRepository.getMedicationById(
                userId,
                medId
              )) as (MedicationDetailRow & { schedules: ScheduleRow[] }) | null;
              if (!med) return ERRORS.NOT_FOUND('Medication', medId);
              return formatList(
                med.schedules ?? [],
                `Schedules — ${med.display_name || med.name}`,
                (s) => {
                  let text = `**${describeSchedule(s)}**`;
                  if (s.active === false) text += ' (inactive)';
                  text += `\n  ID: ${s.id}`;
                  if (s.dose_amount) text += `\n  Dose: ${s.dose_amount}`;
                  if (s.start_date)
                    text += `\n  From: ${dayString(s.start_date)}`;
                  if (s.end_date) text += `\n  Until: ${dayString(s.end_date)}`;
                  if (s.prn_max_per_day) {
                    text += `\n  Max/day: ${s.prn_max_per_day}`;
                  }
                  return text;
                }
              );
            }
            case 'log_symptom': {
              // The SQL default is UTC CURRENT_DATE; anchor to the user's day.
              const entryDate = args.entry_date ?? todayInZone(tz);
              if (args.medication_id) {
                const med = (await medicationRepository.getMedicationById(
                  userId,
                  args.medication_id
                )) as MedicationDetailRow | null;
                if (!med) {
                  return ERRORS.NOT_FOUND('Medication', args.medication_id);
                }
              }
              // Link the entry to a tracked custom symptom when one matches;
              // an unmatched name still logs as a snapshot-only entry.
              const symptoms = (await symptomRepository.listCustomSymptoms(
                userId
              )) as CustomSymptomRow[];
              const q = args.symptom_name.trim().toLowerCase();
              const tracked = symptoms.find(
                (sym) =>
                  sym.name === q ||
                  (sym.display_name ?? '').trim().toLowerCase() === q
              );
              const payload: CreateSymptomEntryBody = {
                symptom_id: tracked?.id ?? null,
                symptom_name_snapshot: args.symptom_name.trim(),
                severity: args.severity ?? null,
                severity_label: args.severity_label ?? null,
                entry_date: entryDate,
                body_location: args.body_location ?? null,
                context_text: args.context_text ?? null,
                bristol_type: args.bristol_type ?? null,
                medication_id: args.medication_id ?? null,
              };
              const entry = (await symptomRepository.createSymptomEntry(
                userId,
                payload
              )) as SymptomEntryRow;
              const details: string[] = [];
              if (entry.severity !== null) {
                details.push(`severity ${entry.severity}/10`);
              }
              if (entry.severity_label) details.push(entry.severity_label);
              if (entry.body_location) details.push(entry.body_location);
              if (entry.bristol_type !== null) {
                details.push(`Bristol type ${entry.bristol_type}`);
              }
              const suffix = details.length ? ` (${details.join(', ')})` : '';
              return formatConfirmation(
                `Symptom "${entry.symptom_name_snapshot}"${suffix} logged for ${dayString(entry.entry_date)}.`
              );
            }
            case 'list_symptoms': {
              const symptoms = (await symptomRepository.listCustomSymptoms(
                userId
              )) as CustomSymptomRow[];
              return formatList(symptoms, 'Tracked Symptoms', (sym) => {
                let text = `**${sym.display_name || sym.name}**`;
                if (sym.is_glp1_flagged) text += ' (GLP-1 side effect)';
                text += `\n  Scale: ${sym.scale_type}`;
                if (sym.unit) text += ` (${sym.unit})`;
                return text;
              });
            }
            case 'list_symptom_entries': {
              const entries = (await symptomRepository.listSymptomEntries(
                userId,
                {
                  fromDate: args.from_date,
                  toDate: args.to_date,
                  symptomName: args.symptom_name,
                }
              )) as SymptomEntryRow[];
              return formatList(entries, 'Symptom Entries', (e) => {
                let text = `**${e.symptom_name_snapshot}** on ${dayString(e.entry_date)}`;
                if (e.severity !== null) text += ` — severity ${e.severity}/10`;
                else if (e.severity_label) text += ` — ${e.severity_label}`;
                if (e.body_location) text += ` (${e.body_location})`;
                if (e.bristol_type !== null) {
                  text += ` — Bristol type ${e.bristol_type}`;
                }
                if (e.context_text) text += ` — ${e.context_text}`;
                return text;
              });
            }
            default:
              return ERRORS.INVALID_ACTION(
                (args as { action?: string }).action ?? 'unknown',
                VALID_ACTIONS
              );
          }
        } catch (error) {
          log('error', '[Medication Tool] Error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
