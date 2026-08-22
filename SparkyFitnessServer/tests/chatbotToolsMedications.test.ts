import { vi, beforeEach, describe, expect, it } from 'vitest';
import { buildMedicationTools } from '../ai/tools/medicationTools.js';
import medicationRepository from '../models/medicationRepository.js';

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
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };

const MED_ID = '11111111-1111-4111-8111-111111111111';
const MED_ID_2 = '22222222-2222-4222-8222-222222222222';
const SCHED_ID = '33333333-3333-4333-8333-333333333333';

// A stored medication the way the repository returns it.
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
};

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
