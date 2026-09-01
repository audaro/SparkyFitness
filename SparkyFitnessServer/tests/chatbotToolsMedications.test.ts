import { vi, beforeEach, describe, expect, it } from 'vitest';
import { todayInZone } from '@workspace/shared';
import { buildMedicationTools } from '../ai/tools/medicationTools.js';
import medicationRepository from '../models/medicationRepository.js';
import symptomRepository from '../models/symptomRepository.js';

vi.mock('../models/medicationRepository', () => ({
  default: {
    createMedication: vi.fn(),
    listMedications: vi.fn(),
    getMedicationById: vi.fn(),
    updateMedication: vi.fn(),
    deleteMedication: vi.fn(),
    addSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  },
}));
vi.mock('../models/medicationEntryRepository', () => ({
  default: {
    createEntry: vi.fn(),
    listEntriesWithInjections: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
}));
vi.mock('../models/injectionRepository', () => ({
  default: {
    createInjection: vi.fn(),
    listInjections: vi.fn(),
  },
}));
vi.mock('../models/symptomRepository', () => ({
  default: {
    listCustomSymptoms: vi.fn(),
    createSymptomEntry: vi.fn(),
    listSymptomEntries: vi.fn(),
  },
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };

// Derived from the repository rather than restated, so a column added to the
// table shows up here as a type error instead of a fixture that has quietly
// stopped resembling a real row.
type MedicationListRow = Awaited<
  ReturnType<typeof medicationRepository.listMedications>
>[number];
type MedicationScheduleRow = MedicationListRow['schedules'][number];

const MED_ID =
  '11111111-1111-4111-8111-111111111111' as MedicationListRow['id'];
const MED_ID_2 =
  '22222222-2222-4222-8222-222222222222' as MedicationListRow['id'];
const SCHED_ID = '33333333-3333-4333-8333-333333333333';

// A stored medication the way the repository returns it, narrowed to the columns
// these tools actually read. The rest of the row - timestamps, lookup ids, the
// custom-field bag - is filled by the database and never inspected here, so the
// fixture states what is under test rather than two dozen nulls.
const metformin = {
  id: MED_ID,
  user_id: 'user-1',
  name: 'Metformin',
  display_name: null,
  strength_value: 500,
  strength_unit: 'mg',
  dose_amount: 1,
  dose_unit: 'tablet',
  is_active: true,
  is_glp1: false,
  is_supplement: false,
  reason_text: null,
  notes: null,
  schedules: [],
} as unknown as MedicationListRow;

const specificDaysSchedule = {
  id: SCHED_ID,
  medication_id: MED_ID,
  user_id: 'user-1',
  schedule_type_id: 'specific_days',
  time_of_day: '08:00',
  dose_amount: null,
  days_of_week: [1, 3, 5],
  interval_days: null,
  day_of_month: null,
  cycle_on_days: null,
  cycle_off_days: null,
  with_meal: 'with',
  prn_reason: null,
  prn_max_per_day: null,
  start_date: null,
  end_date: null,
  active: true,
} as unknown as MedicationScheduleRow;

const SYMPTOM_ID = '44444444-4444-4444-8444-444444444444';

// A tracked custom symptom the way the repository returns it (names are
// stored lowercased/trimmed by the upsert).
const nauseaSymptom = {
  id: SYMPTOM_ID,
  name: 'nausea',
  display_name: 'Nausea',
  scale_type: 'severity',
  unit: null,
  is_glp1_flagged: true,
};

const nauseaEntry = {
  id: MED_ID_2,
  symptom_name_snapshot: 'Nausea',
  severity: 6,
  severity_label: null,
  entry_date: '2026-08-21',
  body_location: null,
  context_text: null,
  bristol_type: null,
};

let tools: ReturnType<typeof buildMedicationTools>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = buildMedicationTools('user-1', 'UTC');
});

describe('medication management', () => {
  it('create_medication sends only the provided fields', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([]);
    vi.mocked(medicationRepository.createMedication).mockResolvedValue(
      metformin
    );

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'create_medication',
        name: 'Metformin',
        strength_value: 500,
        strength_unit: 'mg',
        reason_text: 'Blood sugar control',
      },
      opts
    );

    expect(result).toBe(
      `✅ Medication "Metformin" created (ID: ${MED_ID}). Use add_schedule to set when it is taken.`
    );
    expect(medicationRepository.createMedication).toHaveBeenCalledWith(
      'user-1',
      {
        name: 'Metformin',
        strength_value: 500,
        strength_unit: 'mg',
        reason_text: 'Blood sugar control',
      }
    );
  });

  it('create_medication rejects a case-only duplicate name', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      metformin,
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'create_medication', name: 'metformin' },
      opts
    );

    expect(result).toBe(
      `Error [VALIDATION]: A medication named "metformin" already exists (medication_id ${MED_ID}) — use update_medication to change it, or choose a different name`
    );
    expect(medicationRepository.createMedication).not.toHaveBeenCalled();
  });

  it('create_medication rejects a display_name that collides with an existing medication', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      metformin,
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'create_medication',
        name: 'Glucophage',
        display_name: 'Metformin',
      },
      opts
    );

    expect(result).toBe(
      `Error [VALIDATION]: A medication named "Metformin" already exists (medication_id ${MED_ID}) — use update_medication to change it, or choose a different name`
    );
    expect(medicationRepository.createMedication).not.toHaveBeenCalled();
  });

  it('infers update_medication from an identifier plus a patch field', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );
    vi.mocked(medicationRepository.updateMedication).mockResolvedValue({
      ...metformin,
      is_active: false,
    });

    const result = await tools.sparky_manage_medications.execute!(
      { medication_id: MED_ID, is_active: false },
      opts
    );

    expect(result).toBe('✅ Medication "Metformin" updated.');
    expect(medicationRepository.updateMedication).toHaveBeenCalledWith(
      'user-1',
      MED_ID,
      { is_active: false }
    );
  });

  it('infers create_medication from a bare name and update from name + id', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([]);
    vi.mocked(medicationRepository.createMedication).mockResolvedValue(
      metformin
    );

    const created = await tools.sparky_manage_medications.execute!(
      { name: 'Metformin', is_supplement: false },
      opts
    );
    expect(created).toBe(
      `✅ Medication "Metformin" created (ID: ${MED_ID}). Use add_schedule to set when it is taken.`
    );

    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );
    vi.mocked(medicationRepository.updateMedication).mockResolvedValue(
      metformin
    );
    const updated = await tools.sparky_manage_medications.execute!(
      { medication_id: MED_ID, new_name: 'Metformin XR' },
      opts
    );
    expect(updated).toBe('✅ Medication "Metformin" updated.');
  });

  it('update_medication patches only the provided fields', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );
    vi.mocked(medicationRepository.updateMedication).mockResolvedValue({
      ...metformin,
      dose_amount: 2,
    });

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'update_medication', medication_id: MED_ID, dose_amount: 2 },
      opts
    );

    expect(result).toBe('✅ Medication "Metformin" updated.');
    expect(medicationRepository.updateMedication).toHaveBeenCalledWith(
      'user-1',
      MED_ID,
      { dose_amount: 2 }
    );
  });

  it('update_medication validates identifier, unknown id, and empty patch', async () => {
    const noId = await tools.sparky_manage_medications.execute!(
      { action: 'update_medication', dose_amount: 2 },
      opts
    );
    expect(noId).toContain('Either medication_id or medication_name');

    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(null);
    const missing = await tools.sparky_manage_medications.execute!(
      { action: 'update_medication', medication_id: MED_ID_2, dose_amount: 2 },
      opts
    );
    expect(missing).toBe(
      `Error [NOT_FOUND]: Medication with ID '${MED_ID_2}' not found.\n\nSuggestion: Check the ID and try again.`
    );

    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );
    const empty = await tools.sparky_manage_medications.execute!(
      { action: 'update_medication', medication_id: MED_ID },
      opts
    );
    expect(empty).toBe(
      'Error [VALIDATION]: Nothing to update — provide new_name or at least one medication field'
    );
  });

  it('update_medication rejects renaming onto another medication', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      metformin,
      { ...metformin, id: MED_ID_2, name: 'Berberine', display_name: null },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_medication',
        medication_id: MED_ID,
        new_name: 'BERBERINE',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: A medication named "BERBERINE" already exists — choose a different name'
    );
    expect(medicationRepository.updateMedication).not.toHaveBeenCalled();
  });

  it('resolves an ambiguous medication_name to an error instead of first match', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      metformin,
      { ...metformin, id: MED_ID_2, display_name: 'Metformin' },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_medication',
        medication_name: 'Metformin',
        dose_amount: 2,
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Multiple medications are named "Metformin" — use medication_id (see list_medications)'
    );
  });
});

describe('medication schedules', () => {
  it('add_schedule verifies ownership and reports the schedule', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );
    vi.mocked(medicationRepository.addSchedule).mockResolvedValue(
      specificDaysSchedule
    );

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'specific_days',
        days_of_week: [1, 3, 5],
        time_of_day: '08:00',
        with_meal: 'with',
      },
      opts
    );

    expect(result).toBe(
      `✅ Schedule added to Metformin: specific_days on Mon, Wed, Fri at 08:00 (with meal) (schedule_id ${SCHED_ID}).`
    );
    expect(medicationRepository.addSchedule).toHaveBeenCalledWith(
      'user-1',
      MED_ID,
      {
        schedule_type_id: 'specific_days',
        days_of_week: [1, 3, 5],
        time_of_day: '08:00',
        with_meal: 'with',
      }
    );
  });

  it('add_schedule rejects an unknown medication before inserting', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(null);

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID_2,
        schedule_type_id: 'daily',
      },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Medication with ID '${MED_ID_2}' not found.\n\nSuggestion: Check the ID and try again.`
    );
    expect(medicationRepository.addSchedule).not.toHaveBeenCalled();
  });

  it('add_schedule requires the type-specific fields', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );

    const noDays = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'weekly',
      },
      opts
    );
    expect(noDays).toBe(
      'Error [VALIDATION]: A weekly schedule needs days_of_week (0=Sunday … 6=Saturday) — without it the schedule would never come due'
    );

    const noInterval = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'every_n_days',
      },
      opts
    );
    expect(noInterval).toBe(
      'Error [VALIDATION]: An every_n_days schedule needs interval_days — without it the schedule would never come due'
    );

    const noDayOfMonth = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'monthly',
      },
      opts
    );
    expect(noDayOfMonth).toBe(
      'Error [VALIDATION]: A monthly schedule needs day_of_month — without it the schedule would never come due'
    );

    const noCycle = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'cyclic',
      },
      opts
    );
    expect(noCycle).toBe(
      'Error [VALIDATION]: A cyclic schedule needs cycle_on_days — without it the schedule would never come due'
    );
    expect(medicationRepository.addSchedule).not.toHaveBeenCalled();
  });

  it('add_schedule requires a start_date anchor for repeating cycle types', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );

    const everyN = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'every_n_days',
        interval_days: 3,
      },
      opts
    );
    expect(everyN).toBe(
      'Error [VALIDATION]: A every_n_days schedule needs start_date — the repeat cycle is counted from it'
    );

    const cyclic = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'cyclic',
        cycle_on_days: 5,
        cycle_off_days: 2,
      },
      opts
    );
    expect(cyclic).toBe(
      'Error [VALIDATION]: A cyclic schedule needs start_date — the repeat cycle is counted from it'
    );
    expect(medicationRepository.addSchedule).not.toHaveBeenCalled();
  });

  it('add_schedule rejects an out-of-range time_of_day', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'daily',
        time_of_day: '99:99',
      },
      opts
    );

    expect(result).toContain('time_of_day must be HH:MM');
    expect(medicationRepository.addSchedule).not.toHaveBeenCalled();
  });

  it('add_schedule rejects an inverted date range', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'daily',
        start_date: '2026-09-01',
        end_date: '2026-08-01',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: end_date must be on or after start_date'
    );
  });

  it('update_schedule patches provided fields and validates the merged type', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      { ...metformin, schedules: [specificDaysSchedule] },
    ]);
    vi.mocked(medicationRepository.updateSchedule).mockResolvedValue({
      ...specificDaysSchedule,
      time_of_day: '21:00',
    });

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_schedule',
        schedule_id: SCHED_ID,
        time_of_day: '21:00',
      },
      opts
    );

    expect(result).toBe(
      '✅ Schedule updated for Metformin: specific_days on Mon, Wed, Fri at 21:00 (with meal).'
    );
    expect(medicationRepository.updateSchedule).toHaveBeenCalledWith(
      'user-1',
      SCHED_ID,
      { time_of_day: '21:00' }
    );

    // Switching the type without its required field is rejected on the
    // merged schedule.
    const badSwitch = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_schedule',
        schedule_id: SCHED_ID,
        schedule_type_id: 'every_n_days',
      },
      opts
    );
    expect(badSwitch).toBe(
      'Error [VALIDATION]: An every_n_days schedule needs interval_days — without it the schedule would never come due'
    );
  });

  it('update_schedule clears type-specific fields on a type switch', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      { ...metformin, schedules: [specificDaysSchedule] },
    ]);
    vi.mocked(medicationRepository.updateSchedule).mockResolvedValue({
      ...specificDaysSchedule,
      schedule_type_id: 'daily',
      days_of_week: null,
      with_meal: 'with',
    });

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_schedule',
        schedule_id: SCHED_ID,
        schedule_type_id: 'daily',
      },
      opts
    );

    expect(result).toBe(
      '✅ Schedule updated for Metformin: daily at 08:00 (with meal).'
    );
    expect(medicationRepository.updateSchedule).toHaveBeenCalledWith(
      'user-1',
      SCHED_ID,
      {
        schedule_type_id: 'daily',
        days_of_week: null,
        interval_days: null,
        day_of_month: null,
        cycle_on_days: null,
        cycle_off_days: null,
        prn_reason: null,
        prn_max_per_day: null,
      }
    );
  });

  it('update_schedule reports unknown schedules and empty patches', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      { ...metformin, schedules: [specificDaysSchedule] },
    ]);

    const missing = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_schedule',
        schedule_id: MED_ID_2,
        time_of_day: '09:00',
      },
      opts
    );
    expect(missing).toBe(
      `Error [NOT_FOUND]: Schedule with ID '${MED_ID_2}' not found.\n\nSuggestion: Check the ID and try again.`
    );

    const empty = await tools.sparky_manage_medications.execute!(
      { action: 'update_schedule', schedule_id: SCHED_ID },
      opts
    );
    expect(empty).toBe(
      'Error [VALIDATION]: Nothing to update — provide at least one schedule field'
    );
  });

  it('delete_schedule deletes by id and maps a miss to NOT_FOUND', async () => {
    vi.mocked(medicationRepository.deleteSchedule).mockResolvedValue(true);
    const ok = await tools.sparky_manage_medications.execute!(
      { action: 'delete_schedule', schedule_id: SCHED_ID },
      opts
    );
    expect(ok).toBe('✅ Schedule deleted.');

    vi.mocked(medicationRepository.deleteSchedule).mockResolvedValue(false);
    const missing = await tools.sparky_manage_medications.execute!(
      { action: 'delete_schedule', schedule_id: SCHED_ID },
      opts
    );
    expect(missing).toBe(
      `Error [NOT_FOUND]: Schedule with ID '${SCHED_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('never infers delete_schedule from a bare schedule_id', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      { ...metformin, schedules: [specificDaysSchedule] },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      { schedule_id: SCHED_ID },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update — provide at least one schedule field'
    );
    expect(medicationRepository.deleteSchedule).not.toHaveBeenCalled();
  });

  it('list_schedules renders schedules with their ids', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      ...metformin,
      schedules: [
        specificDaysSchedule,
        {
          ...specificDaysSchedule,
          id: MED_ID_2,
          schedule_type_id: 'prn',
          time_of_day: null,
          days_of_week: null,
          with_meal: null,
          prn_reason: 'headache',
          prn_max_per_day: 3,
          active: false,
        },
      ],
    });

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'list_schedules', medication_id: MED_ID },
      opts
    );

    expect(result).toBe(
      '# Schedules — Metformin\n\n' +
        `**specific_days on Mon, Wed, Fri at 08:00 (with meal)**\n  ID: ${SCHED_ID}\n\n` +
        `**prn for headache** (inactive)\n  ID: ${MED_ID_2}\n  Max/day: 3`
    );
  });
});

describe('schedule field applicability', () => {
  it('add_schedule rejects fields that do not apply to the schedule type', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      metformin
    );

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'add_schedule',
        medication_id: MED_ID,
        schedule_type_id: 'daily',
        days_of_week: [1],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: days_of_week does not apply to a daily schedule'
    );
    expect(medicationRepository.addSchedule).not.toHaveBeenCalled();
  });

  it('update_schedule rejects echoed fields irrelevant to the new type', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([
      { ...metformin, schedules: [specificDaysSchedule] },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'update_schedule',
        schedule_id: SCHED_ID,
        schedule_type_id: 'daily',
        days_of_week: [1, 3, 5],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: days_of_week does not apply to a daily schedule'
    );
    expect(medicationRepository.updateSchedule).not.toHaveBeenCalled();
  });
});

describe('name trimming', () => {
  it('create_medication trims padded names and rejects whitespace-only ones', async () => {
    vi.mocked(medicationRepository.listMedications).mockResolvedValue([]);
    vi.mocked(medicationRepository.createMedication).mockResolvedValue(
      metformin
    );

    await tools.sparky_manage_medications.execute!(
      { action: 'create_medication', name: '  Metformin  ' },
      opts
    );
    expect(medicationRepository.createMedication).toHaveBeenCalledWith(
      'user-1',
      { name: 'Metformin' }
    );

    const rejected = await tools.sparky_manage_medications.execute!(
      { action: 'create_medication', name: '   ' },
      opts
    );
    expect(rejected).toContain('Error [VALIDATION]');
    expect(medicationRepository.createMedication).toHaveBeenCalledTimes(1);
  });
});

describe('symptoms', () => {
  it('log_symptom links a tracked symptom and defaults entry_date to today', async () => {
    vi.mocked(symptomRepository.listCustomSymptoms).mockResolvedValue([
      nauseaSymptom,
    ]);
    vi.mocked(symptomRepository.createSymptomEntry).mockResolvedValue(
      nauseaEntry
    );

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'log_symptom', symptom_name: 'Nausea', severity: 6 },
      opts
    );

    expect(result).toBe(
      '✅ Symptom "Nausea" (severity 6/10) logged for 2026-08-21.'
    );
    expect(symptomRepository.createSymptomEntry).toHaveBeenCalledWith(
      'user-1',
      {
        symptom_id: SYMPTOM_ID,
        symptom_name_snapshot: 'Nausea',
        severity: 6,
        severity_label: null,
        entry_date: todayInZone('UTC'),
        body_location: null,
        context_text: null,
        bristol_type: null,
        medication_id: null,
      }
    );
  });

  it('log_symptom stores an unmatched name as snapshot-only', async () => {
    vi.mocked(symptomRepository.listCustomSymptoms).mockResolvedValue([
      nauseaSymptom,
    ]);
    vi.mocked(symptomRepository.createSymptomEntry).mockResolvedValue({
      ...nauseaEntry,
      symptom_name_snapshot: 'Headache',
      severity: null,
    });

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'log_symptom',
        symptom_name: '  Headache  ',
        entry_date: '2026-08-21',
      },
      opts
    );

    expect(result).toBe('✅ Symptom "Headache" logged for 2026-08-21.');
    const payload = vi.mocked(symptomRepository.createSymptomEntry).mock
      .calls[0][1];
    expect(payload.symptom_id).toBeNull();
    expect(payload.symptom_name_snapshot).toBe('Headache');
    expect(payload.entry_date).toBe('2026-08-21');
  });

  it('log_symptom verifies ownership of a linked medication', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(null);

    const result = await tools.sparky_manage_medications.execute!(
      {
        action: 'log_symptom',
        symptom_name: 'Nausea',
        medication_id: MED_ID,
      },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Medication with ID '${MED_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
    expect(symptomRepository.createSymptomEntry).not.toHaveBeenCalled();
  });

  it('log_symptom rejects out-of-range severity and bristol_type', async () => {
    const badSeverity = await tools.sparky_manage_medications.execute!(
      { action: 'log_symptom', symptom_name: 'Nausea', severity: 11 },
      opts
    );
    expect(badSeverity).toContain('Error [VALIDATION]');

    const badBristol = await tools.sparky_manage_medications.execute!(
      { action: 'log_symptom', symptom_name: 'Nausea', bristol_type: 8 },
      opts
    );
    expect(badBristol).toContain('Error [VALIDATION]');
    expect(symptomRepository.createSymptomEntry).not.toHaveBeenCalled();
  });

  it('infers log_symptom from symptom_name and list from a date filter', async () => {
    vi.mocked(symptomRepository.listCustomSymptoms).mockResolvedValue([]);
    vi.mocked(symptomRepository.createSymptomEntry).mockResolvedValue(
      nauseaEntry
    );
    vi.mocked(symptomRepository.listSymptomEntries).mockResolvedValue([]);

    await tools.sparky_manage_medications.execute!(
      { symptom_name: 'Nausea', severity: 6 },
      opts
    );
    expect(symptomRepository.createSymptomEntry).toHaveBeenCalledTimes(1);

    await tools.sparky_manage_medications.execute!(
      { symptom_name: 'Nausea', from_date: '2026-08-01' },
      opts
    );
    expect(symptomRepository.listSymptomEntries).toHaveBeenCalledWith(
      'user-1',
      {
        fromDate: '2026-08-01',
        toDate: undefined,
        symptomName: 'Nausea',
      }
    );
  });

  it('list_symptoms renders tracked symptom definitions', async () => {
    vi.mocked(symptomRepository.listCustomSymptoms).mockResolvedValue([
      nauseaSymptom,
      {
        id: MED_ID_2,
        name: 'headache',
        display_name: null,
        scale_type: 'severity',
        unit: null,
        is_glp1_flagged: false,
      },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'list_symptoms' },
      opts
    );

    expect(result).toBe(
      '# Tracked Symptoms\n\n' +
        '**Nausea** (GLP-1 side effect)\n  Scale: severity\n\n' +
        '**headache**\n  Scale: severity'
    );
  });

  it('list_symptom_entries paginates with honest totals', async () => {
    vi.mocked(symptomRepository.listSymptomEntries).mockResolvedValue([
      nauseaEntry,
      { ...nauseaEntry, entry_date: '2026-08-20' },
      { ...nauseaEntry, entry_date: '2026-08-19' },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'list_symptom_entries', limit: 2 },
      opts
    );

    expect(result).toBe(
      '# Symptom Entries\n\n' +
        '**Nausea** on 2026-08-21 — severity 6/10\n\n' +
        '**Nausea** on 2026-08-20 — severity 6/10' +
        '\n\n---\nShowing 2 of 3 results. Use offset=2 to see more.'
    );

    const page2 = await tools.sparky_manage_medications.execute!(
      { action: 'list_symptom_entries', limit: 2, offset: 2 },
      opts
    );
    expect(page2).toBe(
      '# Symptom Entries\n\n' +
        '**Nausea** on 2026-08-19 — severity 6/10' +
        '\n\n---\nShowing 1 of 3 results.'
    );
  });

  it('log_symptom prefers the canonical name and rejects display-name collisions', async () => {
    // "sickness" matches one symptom's display_name and another's canonical
    // name — the canonical match must win.
    vi.mocked(symptomRepository.listCustomSymptoms).mockResolvedValue([
      { ...nauseaSymptom, display_name: 'Sickness' },
      {
        id: MED_ID_2,
        name: 'sickness',
        display_name: null,
        scale_type: 'severity',
        unit: null,
        is_glp1_flagged: false,
      },
    ]);
    vi.mocked(symptomRepository.createSymptomEntry).mockResolvedValue({
      ...nauseaEntry,
      symptom_name_snapshot: 'Sickness',
      severity: null,
    });

    await tools.sparky_manage_medications.execute!(
      { action: 'log_symptom', symptom_name: 'Sickness' },
      opts
    );
    expect(
      vi.mocked(symptomRepository.createSymptomEntry).mock.calls[0][1]
        .symptom_id
    ).toBe(MED_ID_2);

    // Two tracked symptoms sharing a display name are ambiguous.
    vi.mocked(symptomRepository.listCustomSymptoms).mockResolvedValue([
      { ...nauseaSymptom, name: 'nausea', display_name: 'Tummy' },
      {
        id: MED_ID_2,
        name: 'stomach ache',
        display_name: 'Tummy',
        scale_type: 'severity',
        unit: null,
        is_glp1_flagged: false,
      },
    ]);
    const ambiguous = await tools.sparky_manage_medications.execute!(
      { action: 'log_symptom', symptom_name: 'Tummy' },
      opts
    );
    expect(ambiguous).toBe(
      'Error [VALIDATION]: Multiple tracked symptoms are named "Tummy" — see list_symptoms and use the exact stored name'
    );
    expect(symptomRepository.createSymptomEntry).toHaveBeenCalledTimes(1);
  });

  it('log_symptom rejects labels and locations longer than their DB columns', async () => {
    const longLabel = await tools.sparky_manage_medications.execute!(
      {
        action: 'log_symptom',
        symptom_name: 'Nausea',
        severity_label: 'x'.repeat(41),
      },
      opts
    );
    expect(longLabel).toContain('Error [VALIDATION]');

    const longLocation = await tools.sparky_manage_medications.execute!(
      {
        action: 'log_symptom',
        symptom_name: 'Nausea',
        body_location: 'x'.repeat(61),
      },
      opts
    );
    expect(longLocation).toContain('Error [VALIDATION]');
    expect(symptomRepository.createSymptomEntry).not.toHaveBeenCalled();
  });

  it('list_symptom_entries renders entries with their details', async () => {
    vi.mocked(symptomRepository.listSymptomEntries).mockResolvedValue([
      nauseaEntry,
      {
        ...nauseaEntry,
        symptom_name_snapshot: 'Stomach ache',
        severity: null,
        severity_label: 'moderate',
        body_location: 'lower abdomen',
        bristol_type: 6,
        context_text: 'after dinner',
      },
    ]);

    const result = await tools.sparky_manage_medications.execute!(
      { action: 'list_symptom_entries' },
      opts
    );

    expect(result).toBe(
      '# Symptom Entries\n\n' +
        '**Nausea** on 2026-08-21 — severity 6/10\n\n' +
        '**Stomach ache** on 2026-08-21 — moderate (lower abdomen) — Bristol type 6 — after dinner' +
        '\n\n---\nShowing 2 of 2 results.'
    );
  });
});
