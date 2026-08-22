import { z } from 'zod';
import {
  dateSchema,
  optionalDateSchema,
  paginationSchema,
  uuidSchema,
} from './common.js';

// Fixed lookup table medication_schedule_types — seeded by migration, never
// user-editable, so the ids are pinned here instead of a lookup action.
export const SCHEDULE_TYPE_IDS = [
  'daily',
  'specific_days',
  'every_n_days',
  'cyclic',
  'weekly',
  'monthly',
  'prn',
  'taper',
] as const;

const scheduleTypeEnum = z
  .enum(SCHEDULE_TYPE_IDS)
  .describe(
    'Schedule type: daily, specific_days (needs days_of_week), every_n_days (needs interval_days), cyclic (needs cycle_on_days), weekly (needs days_of_week), monthly (needs day_of_month), prn (as needed), taper'
  );

const timeOfDaySchema = z
  .string()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'time_of_day must be HH:MM')
  .describe('Time of day (HH:MM, 24-hour)');

// Medication fields the chat surface exposes for create/update — form-only
// columns (colors, icons, pharmacy details, nutrient panels) stay in the UI.
const medicationEditFields = {
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Display name shown in the UI (defaults to name)'),
  strength_value: z
    .number()
    .positive()
    .optional()
    .describe('Strength per unit (e.g. 500 for 500mg tablets)'),
  strength_unit: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe('Strength unit (mg, mcg, IU, ...)'),
  dose_amount: z
    .number()
    .positive()
    .optional()
    .describe('Default dose amount per intake'),
  dose_unit: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe('Default dose unit (tablets, mg, mL, ...)'),
  reason_text: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe('Why the medication is taken'),
  is_active: z
    .boolean()
    .optional()
    .describe('Whether the medication is active'),
  is_glp1: z
    .boolean()
    .optional()
    .describe('Whether this is a GLP-1 medication'),
  is_supplement: z
    .boolean()
    .optional()
    .describe('Whether this is a supplement'),
};

// Schedule fields shared by add_schedule / update_schedule.
const scheduleEditFields = {
  time_of_day: timeOfDaySchema.optional(),
  dose_amount: z
    .number()
    .positive()
    .optional()
    .describe('Dose amount for this schedule slot'),
  days_of_week: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .optional()
    .describe(
      'Days of week (0=Sunday … 6=Saturday) — required for specific_days/weekly'
    ),
  interval_days: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Repeat every N days — required for every_n_days'),
  day_of_month: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe('Day of the month (1-31) — required for monthly'),
  cycle_on_days: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Days on per cycle — required for cyclic'),
  cycle_off_days: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Days off per cycle (cyclic)'),
  with_meal: z
    .enum(['before', 'with', 'after', 'away_from_meals'])
    .optional()
    .describe('Relation to meals'),
  prn_reason: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe('Reason for as-needed use (prn)'),
  prn_max_per_day: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum doses per day (prn)'),
  start_date: dateSchema
    .optional()
    .describe('Schedule start date (YYYY-MM-DD)'),
  end_date: dateSchema.optional().describe('Schedule end date (YYYY-MM-DD)'),
  active: z.boolean().optional().describe('Whether the schedule is active'),
};

const listMedicationsSchema = z
  .object({
    action: z.literal('list_medications'),
    glp1_only: z
      .boolean()
      .optional()
      .describe('Filter to GLP-1 medications only'),
    active_only: z
      .boolean()
      .optional()
      .describe('Filter to active medications only'),
  })
  .strict();

const getMedicationSchema = z
  .object({
    action: z.literal('get_medication'),
    medication_id: uuidSchema.describe('UUID of the medication'),
  })
  .strict();

const logDoseSchema = z
  .object({
    action: z.literal('log'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
    status: z
      .enum(['taken', 'skipped', 'snoozed', 'prn_taken'])
      .optional()
      .describe('Dose status (defaults to taken)'),
    taken_at: z
      .string()
      .optional()
      .describe('ISO timestamp when the dose was taken'),
    entry_date: optionalDateSchema,
    dose_amount_snapshot: z
      .number()
      .optional()
      .describe('Dose amount (e.g. 10 for 10 mg)'),
    dose_unit_snapshot: z
      .string()
      .optional()
      .describe('Dose unit (e.g. mg, mL)'),
    notes: z.string().optional().describe('Optional notes about the dose'),
  })
  .strict();

const listEntriesSchema = z
  .object({
    action: z.literal('list_entries'),
    medication_id: uuidSchema
      .optional()
      .describe('Filter to a specific medication'),
    from_date: optionalDateSchema,
    to_date: optionalDateSchema,
  })
  .strict();

const updateEntrySchema = z
  .object({
    action: z.literal('update_entry'),
    entry_id: uuidSchema.describe('UUID of the entry to update'),
    status: z
      .enum(['taken', 'skipped', 'snoozed', 'prn_taken'])
      .optional()
      .describe('New dose status'),
    taken_at: z
      .string()
      .optional()
      .describe('New ISO timestamp when the dose was taken'),
    entry_date: optionalDateSchema,
    notes: z
      .string()
      .nullable()
      .optional()
      .describe('New notes (pass null to clear)'),
  })
  .strict();

const deleteEntrySchema = z
  .object({
    action: z.literal('delete_entry'),
    entry_id: uuidSchema.describe('UUID of the entry to delete'),
  })
  .strict();

const logInjectionSchema = z
  .object({
    action: z.literal('log_injection'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the GLP-1 medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
    dose_mg: z
      .number()
      .optional()
      .describe(
        'Dose in mg (defaults from active titration step or medication dose)'
      ),
    site: z
      .string()
      .optional()
      .describe('Injection site (abdomen, thigh, arm, etc.)'),
    deduct_pen: z
      .boolean()
      .optional()
      .describe(
        'Whether to deduct from pen inventory (auto-picks best pen if true)'
      ),
    entry_date: optionalDateSchema,
    notes: z.string().optional().describe('Optional notes'),
  })
  .strict();

const listInjectionsSchema = z
  .object({
    action: z.literal('list_injections'),
    medication_id: uuidSchema
      .optional()
      .describe('Filter to a specific medication'),
    from_date: optionalDateSchema,
    to_date: optionalDateSchema,
  })
  .strict();

const createMedicationSchema = z
  .object({
    action: z.literal('create_medication'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Medication or supplement name'),
    notes: z.string().max(2000).optional().describe('Notes'),
    ...medicationEditFields,
  })
  .strict();

const updateMedicationSchema = z
  .object({
    action: z.literal('update_medication'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
    new_name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('New name for the medication'),
    notes: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .describe('New notes (pass null to clear)'),
    ...medicationEditFields,
  })
  .strict();

const addScheduleSchema = z
  .object({
    action: z.literal('add_schedule'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
    schedule_type_id: scheduleTypeEnum,
    ...scheduleEditFields,
  })
  .strict();

const updateScheduleSchema = z
  .object({
    action: z.literal('update_schedule'),
    schedule_id: uuidSchema.describe(
      'UUID of the schedule (see list_schedules)'
    ),
    schedule_type_id: scheduleTypeEnum.optional(),
    ...scheduleEditFields,
  })
  .strict();

const deleteScheduleSchema = z
  .object({
    action: z.literal('delete_schedule'),
    schedule_id: uuidSchema.describe(
      'UUID of the schedule to delete (see list_schedules)'
    ),
  })
  .strict();

const listSchedulesSchema = z
  .object({
    action: z.literal('list_schedules'),
    medication_id: uuidSchema
      .optional()
      .describe('UUID of the medication (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Name of the medication (alternative to medication_id)'),
  })
  .strict();

const logSymptomSchema = z
  .object({
    action: z.literal('log_symptom'),
    symptom_name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Symptom name (e.g. nausea, headache)'),
    severity: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Severity 1 (mild) to 10 (severe)'),
    severity_label: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe('Severity label for non-numeric scales (e.g. moderate)'),
    body_location: z
      .string()
      .min(1)
      .max(60)
      .optional()
      .describe('Where on the body (e.g. left knee)'),
    context_text: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe('Free-text context (what happened, triggers)'),
    bristol_type: z
      .number()
      .int()
      .min(1)
      .max(7)
      .optional()
      .describe('Bristol stool scale type 1-7 (digestive symptoms)'),
    medication_id: uuidSchema
      .optional()
      .describe('Medication suspected as the cause (or use medication_name)'),
    medication_name: z
      .string()
      .optional()
      .describe('Medication name (alternative to medication_id)'),
    entry_date: optionalDateSchema,
  })
  .strict();

const listSymptomsSchema = z
  .object({
    action: z.literal('list_symptoms'),
  })
  .strict();

const listSymptomEntriesSchema = z
  .object({
    action: z.literal('list_symptom_entries'),
    symptom_name: z
      .string()
      .optional()
      .describe('Filter to one symptom by name'),
    from_date: optionalDateSchema,
    to_date: optionalDateSchema,
    ...paginationSchema.shape,
  })
  .strict();

export const manageMedicationsSchema = z
  .discriminatedUnion('action', [
    listMedicationsSchema,
    getMedicationSchema,
    logDoseSchema,
    listEntriesSchema,
    updateEntrySchema,
    deleteEntrySchema,
    logInjectionSchema,
    listInjectionsSchema,
    createMedicationSchema,
    updateMedicationSchema,
    addScheduleSchema,
    updateScheduleSchema,
    deleteScheduleSchema,
    listSchedulesSchema,
    logSymptomSchema,
    listSymptomsSchema,
    listSymptomEntriesSchema,
  ])
  .refine(
    (data) => {
      if (
        data.action === 'log' ||
        data.action === 'log_injection' ||
        data.action === 'update_medication' ||
        data.action === 'add_schedule' ||
        data.action === 'list_schedules'
      ) {
        return !!(data.medication_id || data.medication_name);
      }
      return true;
    },
    { message: 'Either medication_id or medication_name is required' }
  );

export type ManageMedicationsInput = z.infer<typeof manageMedicationsSchema>;

export const manageMedicationsInput = z.object({
  action: z
    .enum([
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
    ])
    .optional()
    .describe('Action to perform'),
  name: z
    .string()
    .optional()
    .describe(
      'Medication name — for create_medication (use new_name to rename)'
    ),
  new_name: z
    .string()
    .optional()
    .describe('New medication name (for update_medication)'),
  schedule_id: uuidSchema
    .optional()
    .describe(
      'UUID of the schedule (for update_schedule / delete_schedule, see list_schedules)'
    ),
  schedule_type_id: z
    .enum(SCHEDULE_TYPE_IDS)
    .optional()
    .describe(
      'Schedule type (for add_schedule / update_schedule): daily, specific_days, every_n_days, cyclic, weekly, monthly, prn, taper'
    ),
  time_of_day: z
    .string()
    .optional()
    .describe('Schedule time of day (HH:MM, 24-hour)'),
  days_of_week: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe('Schedule days of week (0=Sunday … 6=Saturday)'),
  interval_days: z
    .number()
    .optional()
    .describe('Repeat every N days (every_n_days schedules)'),
  day_of_month: z
    .number()
    .optional()
    .describe('Day of the month 1-31 (monthly schedules)'),
  cycle_on_days: z
    .number()
    .optional()
    .describe('Days on per cycle (cyclic schedules)'),
  cycle_off_days: z
    .number()
    .optional()
    .describe('Days off per cycle (cyclic schedules)'),
  with_meal: z
    .enum(['before', 'with', 'after', 'away_from_meals'])
    .optional()
    .describe('Schedule relation to meals'),
  prn_reason: z
    .string()
    .optional()
    .describe('Reason for as-needed use (prn schedules)'),
  prn_max_per_day: z
    .number()
    .optional()
    .describe('Maximum doses per day (prn schedules)'),
  start_date: optionalDateSchema.describe('Schedule start date (YYYY-MM-DD)'),
  end_date: optionalDateSchema.describe('Schedule end date (YYYY-MM-DD)'),
  active: z.boolean().optional().describe('Whether the schedule is active'),
  display_name: z
    .string()
    .optional()
    .describe('Medication display name (create/update_medication)'),
  strength_value: z
    .number()
    .optional()
    .describe('Medication strength per unit (create/update_medication)'),
  strength_unit: z
    .string()
    .optional()
    .describe('Medication strength unit (create/update_medication)'),
  dose_amount: z
    .number()
    .optional()
    .describe(
      'Default dose amount (create/update_medication or a schedule slot)'
    ),
  dose_unit: z
    .string()
    .optional()
    .describe('Default dose unit (create/update_medication)'),
  reason_text: z
    .string()
    .optional()
    .describe('Why the medication is taken (create/update_medication)'),
  is_active: z
    .boolean()
    .optional()
    .describe('Whether the medication is active (create/update_medication)'),
  is_glp1: z
    .boolean()
    .optional()
    .describe('Whether this is a GLP-1 medication (create/update_medication)'),
  is_supplement: z
    .boolean()
    .optional()
    .describe('Whether this is a supplement (create/update_medication)'),
  symptom_name: z
    .string()
    .optional()
    .describe(
      'Symptom name — logs it (log_symptom) or filters entries (list_symptom_entries)'
    ),
  severity: z
    .number()
    .optional()
    .describe('Symptom severity 1 (mild) to 10 (severe)'),
  severity_label: z
    .string()
    .max(40)
    .optional()
    .describe('Symptom severity label for non-numeric scales'),
  body_location: z
    .string()
    .max(60)
    .optional()
    .describe('Where on the body the symptom occurs'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum results to return — for list_symptom_entries'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Results to skip for pagination — for list_symptom_entries'),
  context_text: z
    .string()
    .optional()
    .describe('Free-text context for the symptom entry'),
  bristol_type: z
    .number()
    .optional()
    .describe('Bristol stool scale type 1-7 (digestive symptoms)'),
  medication_id: uuidSchema.optional().describe('UUID of the medication'),
  medication_name: z
    .string()
    .optional()
    .describe(
      'Name of the medication (alternative to medication_id for log / log_injection)'
    ),
  entry_id: uuidSchema
    .optional()
    .describe('UUID of the entry (for update_entry / delete_entry)'),
  status: z
    .enum(['taken', 'skipped', 'snoozed', 'prn_taken'])
    .optional()
    .describe('Dose status'),
  taken_at: z
    .string()
    .optional()
    .describe('ISO timestamp when the dose was taken'),
  entry_date: optionalDateSchema.describe(
    'Calendar date for the dose (YYYY-MM-DD, defaults to today)'
  ),
  notes: z.string().nullable().optional().describe('Notes about the entry'),
  glp1_only: z
    .boolean()
    .optional()
    .describe('Filter to GLP-1 medications only'),
  active_only: z
    .boolean()
    .optional()
    .describe('Filter to active medications only'),
  from_date: optionalDateSchema,
  to_date: optionalDateSchema,
  dose_mg: z.number().optional().describe('Dose in mg (for log_injection)'),
  dosage: z
    .number()
    .optional()
    .describe('Dosage amount (alternative to dose_amount_snapshot, e.g. 10)'),
  dosage_unit: z
    .string()
    .optional()
    .describe('Dosage unit (alternative to dose_unit_snapshot, e.g. mg)'),
  dose_amount_snapshot: z
    .number()
    .optional()
    .describe('Dosage amount (alternative to dosage, e.g. 10)'),
  dose_unit_snapshot: z
    .string()
    .optional()
    .describe('Dosage unit (alternative to dosage_unit, e.g. mg)'),
  site: z.string().optional().describe('Injection site'),
  deduct_pen: z
    .boolean()
    .optional()
    .describe('Whether to deduct from pen inventory'),
});
