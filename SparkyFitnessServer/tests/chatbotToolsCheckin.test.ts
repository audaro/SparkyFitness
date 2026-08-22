import { vi, beforeEach, describe, expect, it } from 'vitest';
import { todayInZone } from '@workspace/shared';
import { buildCheckinTools } from '../ai/tools/checkinTools.js';
import measurementService from '../services/measurementService.js';
import preferenceService from '../services/preferenceService.js';
import moodRepository from '../models/moodRepository.js';
import fastingRepository from '../models/fastingRepository.js';
import sleepRepository from '../models/sleepRepository.js';
import { clearUserTdeeCache } from '../services/AdaptiveTdeeService.js';

vi.mock('../services/measurementService', () => ({
  default: {
    upsertCheckInMeasurements: vi.fn(),
    getCheckInMeasurements: vi.fn(),
    updateCheckInMeasurements: vi.fn(),
    deleteCheckInMeasurements: vi.fn(),
    getCheckInMeasurementsByDateRange: vi.fn(),
    getCustomCategories: vi.fn(),
    createCustomCategory: vi.fn(),
    upsertCustomMeasurementEntry: vi.fn(),
    getCustomMeasurementEntriesByDate: vi.fn(),
    processSleepEntry: vi.fn(),
  },
}));
vi.mock('../services/preferenceService', () => ({
  default: {
    getUserPreferences: vi.fn(),
  },
}));
vi.mock('../models/moodRepository', () => ({
  default: {
    createOrUpdateMoodEntry: vi.fn(),
    getMoodEntryByDate: vi.fn(),
  },
}));
vi.mock('../models/fastingRepository', () => ({
  default: {
    createFastingLog: vi.fn(),
    updateFast: vi.fn(),
    getCurrentFast: vi.fn(),
    getFastingLogsOverlappingDay: vi.fn(),
  },
}));
vi.mock('../models/sleepRepository', () => ({
  default: {
    getSleepEntriesByUserIdAndDateRange: vi.fn(),
  },
}));
vi.mock('../services/AdaptiveTdeeService', () => ({
  clearUserTdeeCache: vi.fn(),
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };
const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';

let tools: ReturnType<typeof buildCheckinTools>;

function mockEmptyDiary() {
  vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({});
  vi.mocked(moodRepository.getMoodEntryByDate).mockResolvedValue(undefined);
  vi.mocked(
    sleepRepository.getSleepEntriesByUserIdAndDateRange
  ).mockResolvedValue([]);
  vi.mocked(fastingRepository.getFastingLogsOverlappingDay).mockResolvedValue(
    []
  );
  vi.mocked(
    measurementService.getCustomMeasurementEntriesByDate
  ).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({});
  tools = buildCheckinTools('user-1', 'UTC');
});

describe('log_biometrics', () => {
  it('converts explicit units to kg/cm for storage and echoes the input units', async () => {
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_biometrics',
        entry_date: '2026-06-01',
        weight: 180,
        weight_unit: 'lbs',
        waist: 32,
        measurements_unit: 'in',
        steps: 9000,
      },
      opts
    );

    expect(result).toBe(
      '✅ Biometrics logged for 2026-06-01 (weight: 180lbs, steps: 9000, waist: 32in).'
    );
    expect(measurementService.upsertCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-01',
      {
        weight: 180 * 0.45359237,
        waist: 32 * 2.54,
        steps: 9000,
      }
    );
  });

  it('stores smart-scale composition, converting masses by weight_unit', async () => {
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_biometrics',
        entry_date: '2026-06-01',
        muscle_mass: 80,
        bone_mass: 8,
        body_water: 55.4,
        weight_unit: 'lbs',
      },
      opts
    );

    expect(result).toBe(
      '✅ Biometrics logged for 2026-06-01 (muscle mass: 80lbs, bone mass: 8lbs, body water: 55.4%).'
    );
    expect(measurementService.upsertCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-01',
      {
        muscle_mass_kg: 80 * 0.45359237,
        bone_mass_kg: 8 * 0.45359237,
        // A percentage is never unit-converted.
        body_water_percentage: 55.4,
      }
    );
  });

  it('defaults smart-scale masses to kg when no weight_unit is given', async () => {
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_biometrics',
        entry_date: '2026-06-01',
        muscle_mass: 34.2,
        bone_mass: 3.1,
      },
      opts
    );

    expect(result).toBe(
      '✅ Biometrics logged for 2026-06-01 (muscle mass: 34.2kg, bone mass: 3.1kg).'
    );
    expect(measurementService.upsertCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-01',
      { muscle_mass_kg: 34.2, bone_mass_kg: 3.1 }
    );
  });

  it("converts the 'lb' and 'ft' alias units for storage", async () => {
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_biometrics',
        entry_date: '2026-06-01',
        weight: 150,
        weight_unit: 'lb',
        height: 6,
        height_unit: 'ft',
      },
      opts
    );

    expect(result).toBe(
      '✅ Biometrics logged for 2026-06-01 (weight: 150lb, height: 6ft).'
    );
    expect(measurementService.upsertCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-01',
      {
        weight: 150 * 0.45359237,
        height: 6 * 30.48,
      }
    );
  });

  it("falls back to the user's preferred units for both conversion and text", async () => {
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      default_weight_unit: 'lbs',
    });
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'log_biometrics', entry_date: '2026-06-01', weight: 180 },
      opts
    );

    // The value is interpreted as lbs (the user's preference), so the text has
    // to say lbs. Reporting 'kg' here told the user a unit that was never used.
    expect(result).toBe(
      '✅ Biometrics logged for 2026-06-01 (weight: 180lbs).'
    );
    expect(measurementService.upsertCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-01',
      { weight: 180 * 0.45359237 }
    );
  });

  it("reports 'no changes' when no measurements are provided", async () => {
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue(
      null
    );

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'log_biometrics', entry_date: '2026-06-01' },
      opts
    );

    expect(result).toBe('✅ Biometrics logged for 2026-06-01 (no changes).');
    expect(measurementService.upsertCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-01',
      {}
    );
  });

  it('rejects an unknown weight unit', async () => {
    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_biometrics',
        entry_date: '2026-06-01',
        weight: 80,
        weight_unit: 'stone',
      } as any,
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: weight_unit: Invalid option: expected one of "kg"|"lbs"|"lb"|"g"'
    );
  });
});

describe('log_custom_metric', () => {
  it('logs against a case-insensitively matched category', async () => {
    vi.mocked(measurementService.getCustomCategories).mockResolvedValue([
      {
        id: 'c1',
        name: 'Blood Pressure',
        measurement_type: 'mmHg',
        frequency: 'Daily',
      },
    ]);
    vi.mocked(
      measurementService.upsertCustomMeasurementEntry
    ).mockResolvedValue({ id: 'm1' });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_custom_metric',
        category_name: 'blood pressure',
        value: 120,
        unit: 'mmHg',
        entry_date: '2026-06-01',
      },
      opts
    );

    expect(result).toBe(
      '✅ Custom metric "blood pressure" logged: 120 mmHg on 2026-06-01.'
    );
    expect(
      measurementService.upsertCustomMeasurementEntry
    ).toHaveBeenCalledWith('user-1', 'user-1', {
      category_id: 'c1',
      value: '120',
      entry_date: '2026-06-01',
      notes: undefined,
    });
  });

  it('logs custom metric successfully for non-daily frequency category', async () => {
    vi.mocked(measurementService.getCustomCategories).mockResolvedValue([
      {
        id: 'c2',
        name: 'Blood Pressure Systolic',
        frequency: 'Unlimited',
      },
    ]);
    vi.mocked(
      measurementService.upsertCustomMeasurementEntry
    ).mockResolvedValue({ id: 'm2' });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_custom_metric',
        category_name: 'Blood Pressure Systolic',
        value: 118,
        unit: 'mmHg',
        entry_date: '2026-08-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Custom metric "Blood Pressure Systolic" logged: 118 mmHg on 2026-08-10.'
    );
    expect(
      measurementService.upsertCustomMeasurementEntry
    ).toHaveBeenCalledWith('user-1', 'user-1', {
      category_id: 'c2',
      value: '118',
      entry_date: '2026-08-10',
      notes: undefined,
    });
  });

  it('asks for create_category when the category does not exist', async () => {
    vi.mocked(measurementService.getCustomCategories).mockResolvedValue([]);

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_custom_metric',
        category_name: 'Hydration',
        value: 5,
        entry_date: '2026-06-01',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Category "Hydration" not found. Create it first using the create_category action.'
    );
    expect(
      measurementService.upsertCustomMeasurementEntry
    ).not.toHaveBeenCalled();
  });
});

describe('list_categories / create_category', () => {
  it('lists categories sorted by name', async () => {
    vi.mocked(measurementService.getCustomCategories).mockResolvedValue([
      { id: 'c2', name: 'Steps Goal', measurement_type: 'steps' },
      { id: 'c1', name: 'Blood Pressure', measurement_type: 'mmHg' },
    ]);

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'list_categories' },
      opts
    );

    expect(result).toBe(
      '# Custom Measurement Categories\n\n' +
        '**Blood Pressure**\n  ID: c1\n\n' +
        '**Steps Goal**\n  ID: c2'
    );
    expect(measurementService.getCustomCategories).toHaveBeenCalledWith(
      'user-1',
      'user-1'
    );
  });

  it('creates a category with MCP defaults', async () => {
    vi.mocked(measurementService.createCustomCategory).mockResolvedValue({
      id: 'c9',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'create_category', category_name: 'Hydration', unit: 'ml' },
      opts
    );

    expect(result).toBe(
      '✅ Category "Hydration" created with measurement type "ml".'
    );
    expect(measurementService.createCustomCategory).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        name: 'Hydration',
        measurement_type: 'ml',
        data_type: 'numeric',
        frequency: 'Daily',
      }
    );
  });

  it('creates a unit-less category', async () => {
    vi.mocked(measurementService.createCustomCategory).mockResolvedValue({
      id: 'c9',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'create_category', category_name: 'Meditation' },
      opts
    );

    expect(result).toBe('✅ Category "Meditation" created.');
    expect(measurementService.createCustomCategory).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        name: 'Meditation',
        measurement_type: 'unit',
        data_type: 'numeric',
        frequency: 'Daily',
      }
    );
  });
});

describe('log_mood', () => {
  it('upserts the mood entry and echoes notes', async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockResolvedValue({
      id: 'mood-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_mood',
        mood_value: 8,
        notes: 'Feeling good',
        entry_date: '2026-06-01',
      },
      opts
    );

    expect(result).toBe('✅ Mood logged for 2026-06-01: 8/10 — Feeling good.');
    expect(moodRepository.createOrUpdateMoodEntry).toHaveBeenCalledWith(
      'user-1',
      8,
      'Feeling good',
      '2026-06-01',
      null
    );
  });

  it('logs mood without notes', async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockResolvedValue({
      id: 'mood-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'log_mood', mood_value: 5, entry_date: '2026-06-01' },
      opts
    );

    expect(result).toBe('✅ Mood logged for 2026-06-01: 5/10.');
    expect(moodRepository.createOrUpdateMoodEntry).toHaveBeenCalledWith(
      'user-1',
      5,
      null,
      '2026-06-01',
      null
    );
  });

  it("defaults to today's date if entry_date is omitted", async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockResolvedValue({
      id: 'mood-1',
    } as any);

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'log_mood', mood_value: 8 } as any,
      opts
    );

    const today = todayInZone('UTC');
    expect(result).toBe(`✅ Mood logged for ${today}: 8/10.`);
    expect(moodRepository.createOrUpdateMoodEntry).toHaveBeenCalledWith(
      'user-1',
      8,
      null,
      today,
      null
    );
  });
});

describe('log_fasting', () => {
  it('creates an active fast without a follow-up update', async () => {
    vi.mocked(fastingRepository.createFastingLog).mockResolvedValue({
      id: 'f1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'log_fasting', start_time: '2026-06-01T20:00:00Z' },
      opts
    );

    expect(result).toBe('✅ Fasting window logged (ACTIVE).');
    expect(fastingRepository.createFastingLog).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01T20:00:00Z',
      null,
      null
    );
    expect(fastingRepository.updateFast).not.toHaveBeenCalled();
  });

  it('records a completed window via a follow-up update', async () => {
    vi.mocked(fastingRepository.createFastingLog).mockResolvedValue({
      id: 'f1',
    });
    vi.mocked(fastingRepository.updateFast).mockResolvedValue({ id: 'f1' });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_fasting',
        start_time: '2026-06-01T20:00:00Z',
        end_time: '2026-06-02T12:00:00Z',
        fasting_status: 'COMPLETED',
        fasting_type: '16:8',
      },
      opts
    );

    expect(result).toBe('✅ Fasting window logged (COMPLETED) — 16:8.');
    expect(fastingRepository.createFastingLog).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01T20:00:00Z',
      null,
      '16:8'
    );
    expect(fastingRepository.updateFast).toHaveBeenCalledWith('f1', 'user-1', {
      end_time: '2026-06-02T12:00:00Z',
      status: 'COMPLETED',
    });
  });
});

describe('log_sleep', () => {
  it('defaults wake time to 7 AM UTC and derives bedtime from the duration', async () => {
    vi.mocked(measurementService.processSleepEntry).mockResolvedValue({
      id: 's1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_sleep',
        entry_date: '2026-06-01',
        duration_seconds: 27000,
        sleep_score: 85,
      },
      opts
    );

    // The provided sleep_score must not be echoed: it is never stored
    // (processSleepEntry computes its own score).
    expect(result).toBe('✅ Sleep logged for 2026-06-01 (7h 30m).');
    expect(measurementService.processSleepEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        entry_date: '2026-06-01',
        bedtime: '2026-05-31T23:30:00.000Z',
        wake_time: '2026-06-01T07:00:00.000Z',
        duration_in_seconds: 27000,
        source: 'manual',
      }
    );
  });

  it("anchors the default wake time at 7 AM in the user's timezone", async () => {
    vi.mocked(measurementService.processSleepEntry).mockResolvedValue({
      id: 's1',
    });
    const tokyoTools = buildCheckinTools('user-1', 'Asia/Tokyo');

    await tokyoTools.sparky_manage_checkin.execute!(
      {
        action: 'log_sleep',
        entry_date: '2026-06-01',
        duration_seconds: 27000,
      },
      opts
    );

    // 7 AM in Tokyo on 2026-06-01 is 22:00 UTC the previous day.
    expect(measurementService.processSleepEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        entry_date: '2026-06-01',
        bedtime: '2026-05-31T14:30:00.000Z',
        wake_time: '2026-05-31T22:00:00.000Z',
        duration_in_seconds: 27000,
        source: 'manual',
      }
    );
  });

  it('derives wake time from bedtime using the default 8h duration', async () => {
    vi.mocked(measurementService.processSleepEntry).mockResolvedValue({
      id: 's1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_sleep',
        entry_date: '2026-06-01',
        bedtime: '2026-05-31T22:00:00.000Z',
      },
      opts
    );

    expect(result).toBe('✅ Sleep logged for 2026-06-01 (recorded).');
    expect(measurementService.processSleepEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        entry_date: '2026-06-01',
        bedtime: '2026-05-31T22:00:00.000Z',
        wake_time: '2026-06-01T06:00:00.000Z',
        duration_in_seconds: 28800,
        source: 'manual',
      }
    );
  });

  it('stamps record_utc_offset_minutes from an explicit-offset caller timestamp', async () => {
    vi.mocked(measurementService.processSleepEntry).mockResolvedValue({
      id: 's1',
    });

    await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_sleep',
        entry_date: '2026-06-01',
        bedtime: '2026-05-31T22:00:00+05:30',
      },
      opts
    );

    expect(measurementService.processSleepEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ record_utc_offset_minutes: 330 })
    );
  });

  it('falls back to the wake_time offset when bedtime carries none', async () => {
    vi.mocked(measurementService.processSleepEntry).mockResolvedValue({
      id: 's1',
    });

    await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_sleep',
        entry_date: '2026-06-01',
        wake_time: '2026-06-01T06:00:00-04:00',
      },
      opts
    );

    expect(measurementService.processSleepEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ record_utc_offset_minutes: -240 })
    );
  });

  it('leaves the stamp unset for Z-suffixed and generated timestamps', async () => {
    vi.mocked(measurementService.processSleepEntry).mockResolvedValue({
      id: 's1',
    });

    await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_sleep',
        entry_date: '2026-06-01',
        bedtime: '2026-05-31T22:00:00.000Z',
      },
      opts
    );

    const payload = vi.mocked(measurementService.processSleepEntry).mock
      .calls[0][2];
    expect(payload.record_utc_offset_minutes).toBeUndefined();
  });
});

describe('list_checkin_diary', () => {
  it('renders all sections with unit conversion', async () => {
    mockEmptyDiary();
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: '2026-06-01',
      weight: 80,
      height: null,
      body_fat_percentage: null,
      neck: null,
      waist: 90,
      hips: null,
      steps: 9000,
    });
    vi.mocked(moodRepository.getMoodEntryByDate).mockResolvedValue({
      id: 'mood-1',
      mood_value: 8,
      notes: 'Good',
      entry_date: '2026-06-01',
    });
    vi.mocked(
      sleepRepository.getSleepEntriesByUserIdAndDateRange
    ).mockResolvedValue([
      {
        id: 's1',
        entry_date: '2026-06-01',
        duration_in_seconds: 27000,
        sleep_score: 85,
        bedtime: '2026-05-31T23:30:00.000Z',
        wake_time: '2026-06-01T07:00:00.000Z',
        source: 'manual',
        created_at: '2026-06-01T08:00:00Z',
      },
    ]);
    vi.mocked(fastingRepository.getFastingLogsOverlappingDay).mockResolvedValue(
      [
        {
          id: 'f1',
          start_time: '2026-06-01T20:00:00.000Z',
          end_time: null,
          status: 'ACTIVE',
          fasting_type: '16:8',
        },
      ]
    );
    vi.mocked(
      measurementService.getCustomMeasurementEntriesByDate
    ).mockResolvedValue([
      {
        id: 'm1',
        value: '120',
        notes: null,
        entry_date: '2026-06-01',
        created_at: '2026-06-01T09:00:00Z',
        custom_categories: { name: 'Blood Pressure', measurement_type: 'mmHg' },
      },
    ]);
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      default_weight_unit: 'lbs',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'list_checkin_diary', entry_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      '### Check-in Diary: 2026-06-01\n\n' +
        '#### Biometrics\n' +
        `- **Weight:** ${80 * 2.20462262} lbs\n` +
        '- **Steps:** 9000\n' +
        '- **Waist:** 90 cm\n' +
        '\n' +
        '## Mood\n' +
        '- 8/10 — Good\n' +
        '\n' +
        '## Sleep\n' +
        '- 7h 30m | score: 85/100 | bed: 2026-05-31T23:30:00.000Z | wake: 2026-06-01T07:00:00.000Z | (manual)\n' +
        '\n' +
        '## Fasting\n' +
        '- ACTIVE (16:8): 2026-06-01T20:00:00.000Z\n' +
        '\n' +
        '## Custom Metrics\n' +
        '- **Blood Pressure**: 120\n' +
        '\n'
    );
  });

  it('renders fasting timestamps from pg Date objects as ISO-8601 strings', async () => {
    mockEmptyDiary();
    vi.mocked(fastingRepository.getFastingLogsOverlappingDay).mockResolvedValue(
      [
        {
          id: 'f1',
          start_time: new Date('2026-06-01T20:00:00Z'),
          end_time: new Date('2026-06-02T12:00:00Z'),
          status: 'COMPLETED',
          fasting_type: '16:8',
        },
      ]
    );

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'list_checkin_diary', entry_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      '### Check-in Diary: 2026-06-01\n\n' +
        '## Fasting\n' +
        '- COMPLETED (16:8): 2026-06-01T20:00:00.000Z → 2026-06-02T12:00:00.000Z\n' +
        '\n'
    );
    expect(fastingRepository.getFastingLogsOverlappingDay).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01',
      'UTC'
    );
  });

  it('renders checkin diary mood section with tags', async () => {
    mockEmptyDiary();
    vi.mocked(moodRepository.getMoodEntryByDate).mockResolvedValue({
      id: 'mood-1',
      mood_value: 7,
      notes: 'Feeling okay',
      mood_tags: ['anxious', 'worried'],
      entry_date: '2026-06-01',
    } as any);

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'list_checkin_diary', entry_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      '### Check-in Diary: 2026-06-01\n\n' +
        '## Mood\n' +
        '- 7/10 [😰 Anxious, 😟 Worried] — Feeling okay\n\n'
    );
  });

  it('defaults to today and reports an empty diary', async () => {
    mockEmptyDiary();

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'list_checkin_diary' },
      opts
    );

    expect(result).toBe(
      '### Check-in Diary: today\n\nNo check-in data found for this date.\n'
    );
    expect(measurementService.getCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      todayInZone('UTC')
    );
  });
});

describe('get_fasting_status', () => {
  it('returns the active fasting session', async () => {
    vi.mocked(fastingRepository.getCurrentFast).mockResolvedValue({
      id: 'f1',
      user_id: 'user-1',
      start_time: '2026-06-01T20:00:00.000Z',
      end_time: null,
      status: 'ACTIVE',
      fasting_type: '16:8',
      created_at: '2026-06-01T20:00:01.000Z',
      target_end_time: null,
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'get_fasting_status' },
      opts
    );

    expect(result).toBe(
      '# Fasting Status\n\n' +
        JSON.stringify(
          {
            id: 'f1',
            user_id: 'user-1',
            start_time: '2026-06-01T20:00:00.000Z',
            end_time: null,
            fasting_status: 'ACTIVE',
            fasting_type: '16:8',
            created_at: '2026-06-01T20:00:01.000Z',
          },
          null,
          2
        )
    );
  });

  it('reports when no fast is active', async () => {
    vi.mocked(fastingRepository.getCurrentFast).mockResolvedValue(undefined);

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'get_fasting_status' },
      opts
    );

    expect(result).toBe('No active fasting session.');
  });
});

describe('get_biometrics_history', () => {
  it('renders oldest-first with converted units', async () => {
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      default_weight_unit: 'lbs',
    });
    vi.mocked(
      measurementService.getCheckInMeasurementsByDateRange
    ).mockResolvedValue([
      {
        entry_date: '2026-06-02',
        weight: 80,
        body_fat_percentage: 22,
        steps: 9000,
      },
      { entry_date: '2026-06-01', weight: 81, steps: null },
    ]);

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'get_biometrics_history',
        start_date: '2026-06-01',
        end_date: '2026-06-02',
      },
      opts
    );

    expect(result).toBe(
      '# Biometrics History\n\n' +
        `**2026-06-01**: Weight: ${81 * 2.20462262}lbs \n\n` +
        `**2026-06-02**: Weight: ${80 * 2.20462262}lbs | BF: 22% | Steps: 9000`
    );
    expect(
      measurementService.getCheckInMeasurementsByDateRange
    ).toHaveBeenCalledWith('user-1', 'user-1', '2026-06-01', '2026-06-02');
  });

  it('defaults to the full history range', async () => {
    vi.mocked(
      measurementService.getCheckInMeasurementsByDateRange
    ).mockResolvedValue([]);

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'get_biometrics_history' },
      opts
    );

    expect(result).toBe('# Biometrics History\n\nNo results found.');
    expect(
      measurementService.getCheckInMeasurementsByDateRange
    ).toHaveBeenCalledWith('user-1', 'user-1', '1970-01-01', '9999-12-31');
  });
});

describe('error handling', () => {
  it("maps service 'not found' errors to VALIDATION", async () => {
    vi.mocked(measurementService.getCustomCategories).mockResolvedValue([
      { id: 'c1', name: 'Hydration' },
    ]);
    vi.mocked(
      measurementService.upsertCustomMeasurementEntry
    ).mockRejectedValue(new Error('Custom category with ID c1 not found.'));

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_custom_metric',
        category_name: 'Hydration',
        value: 5,
        entry_date: '2026-06-01',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Custom category with ID c1 not found.'
    );
  });

  it('returns DB_ERROR for other failures', async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockRejectedValue(
      new Error('boom')
    );

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'log_mood', mood_value: 8, entry_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });

  it('normalizes nested log_mood and defaults mood_value to 5', async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockResolvedValue({
      id: 'mood-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { log_mood: { notes: 'Anxious today', entry_date: '2026-06-01' } } as any,
      opts
    );

    expect(result).toBe('✅ Mood logged for 2026-06-01: 5/10 — Anxious today.');
    expect(moodRepository.createOrUpdateMoodEntry).toHaveBeenCalledWith(
      'user-1',
      5,
      'Anxious today',
      '2026-06-01',
      null
    );
  });

  it('infers log_mood from notes only and defaults mood_value to 5', async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockResolvedValue({
      id: 'mood-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { notes: 'Anxious today', entry_date: '2026-06-01' } as any,
      opts
    );

    expect(result).toBe('✅ Mood logged for 2026-06-01: 5/10 — Anxious today.');
    expect(moodRepository.createOrUpdateMoodEntry).toHaveBeenCalledWith(
      'user-1',
      5,
      'Anxious today',
      '2026-06-01',
      null
    );
  });

  it('logs mood with explicit mood_tags', async () => {
    vi.mocked(moodRepository.createOrUpdateMoodEntry).mockResolvedValue({
      id: 'mood-1',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'log_mood',
        mood_value: 8,
        notes: 'Feeling good',
        mood_tags: ['anxious', 'tired'],
        entry_date: '2026-06-01',
      },
      opts
    );

    expect(result).toBe(
      '✅ Mood logged for 2026-06-01: 8/10 [😰 Anxious, 😴 Tired] — Feeling good.'
    );
    expect(moodRepository.createOrUpdateMoodEntry).toHaveBeenCalledWith(
      'user-1',
      8,
      'Feeling good',
      '2026-06-01',
      ['anxious', 'tired']
    );
  });
});

describe('update_checkin and delete_checkin_entry', () => {
  it('update_checkin corrects values and clears fields on an existing entry', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: todayInZone('UTC'),
      weight: 81,
      waist: 90,
    });
    vi.mocked(measurementService.updateCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    const today = todayInZone('UTC');
    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'update_checkin', weight: 80, clear: ['waist'] },
      opts
    );

    expect(result).toBe(
      `\u2705 Check-in for ${today} updated (weight: 80kg, waist cleared).`
    );
    expect(measurementService.updateCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      today,
      { weight: 80, waist: null }
    );
  });

  it('update_checkin maps tool field names to storage columns when clearing', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: '2026-08-20',
      body_fat_percentage: 25,
    });
    vi.mocked(measurementService.updateCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    await tools.sparky_manage_checkin.execute!(
      {
        action: 'update_checkin',
        entry_date: '2026-08-20',
        clear: ['body_fat', 'muscle_mass'],
      },
      opts
    );

    expect(measurementService.updateCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-08-20',
      { body_fat_percentage: null, muscle_mass_kg: null }
    );
  });

  it('update_checkin errors when no entry exists for the date', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({});

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'update_checkin', entry_date: '2026-08-20', weight: 80 },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: No check-in entry found for 2026-08-20. Use log_biometrics to create one.'
    );
    expect(measurementService.updateCheckInMeasurements).not.toHaveBeenCalled();
  });

  it('update_checkin rejects a field that is both set and cleared', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: '2026-08-20',
      weight: 81,
    });

    const result = await tools.sparky_manage_checkin.execute!(
      {
        action: 'update_checkin',
        entry_date: '2026-08-20',
        weight: 80,
        clear: ['weight'],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: weight cannot be both set and cleared'
    );
    expect(measurementService.updateCheckInMeasurements).not.toHaveBeenCalled();
  });

  it('update_checkin rejects an empty patch', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: '2026-08-20',
      weight: 81,
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'update_checkin', entry_date: '2026-08-20' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update \u2014 provide at least one corrected value or a clear list.'
    );
  });

  it('infers update_checkin from a bare clear list', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: todayInZone('UTC'),
      waist: 90,
    });
    vi.mocked(measurementService.updateCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });

    await tools.sparky_manage_checkin.execute!({ clear: ['waist'] }, opts);

    expect(measurementService.updateCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      todayInZone('UTC'),
      { waist: null }
    );
  });

  it('delete_checkin_entry deletes the resolved row and reports a miss', async () => {
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValueOnce({
      id: 'ci-9',
      entry_date: '2026-08-20',
      weight: 81,
    });
    vi.mocked(measurementService.deleteCheckInMeasurements).mockResolvedValue({
      message: 'Check-in measurement deleted successfully.',
    });

    const result = await tools.sparky_manage_checkin.execute!(
      { action: 'delete_checkin_entry', entry_date: '2026-08-20' },
      opts
    );
    expect(result).toBe('\u2705 Check-in entry for 2026-08-20 deleted.');
    expect(measurementService.deleteCheckInMeasurements).toHaveBeenCalledWith(
      'user-1',
      'ci-9'
    );

    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValueOnce(
      {}
    );
    const miss = await tools.sparky_manage_checkin.execute!(
      { action: 'delete_checkin_entry', entry_date: '2026-08-21' },
      opts
    );
    expect(miss).toBe(
      'Error [VALIDATION]: No check-in entry found for 2026-08-21.'
    );
  });

  it('update and delete refuse a stale earlier row from the on-or-before getter', async () => {
    // The service getter returns the latest row ON OR BEFORE the date; a miss
    // for the requested day must not mutate the earlier row it falls back to.
    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-old',
      entry_date: '2026-08-15',
      weight: 81,
    });

    const del = await tools.sparky_manage_checkin.execute!(
      { action: 'delete_checkin_entry', entry_date: '2026-08-20' },
      opts
    );
    expect(del).toBe(
      'Error [VALIDATION]: No check-in entry found for 2026-08-20.'
    );
    expect(measurementService.deleteCheckInMeasurements).not.toHaveBeenCalled();

    const upd = await tools.sparky_manage_checkin.execute!(
      { action: 'update_checkin', entry_date: '2026-08-20', weight: 80 },
      opts
    );
    expect(upd).toBe(
      'Error [VALIDATION]: No check-in entry found for 2026-08-20. Use log_biometrics to create one.'
    );
    expect(measurementService.updateCheckInMeasurements).not.toHaveBeenCalled();
    expect(clearUserTdeeCache).not.toHaveBeenCalled();
  });

  it('invalidates the adaptive-TDEE cache after each successful mutation', async () => {
    vi.mocked(measurementService.upsertCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });
    await tools.sparky_manage_checkin.execute!(
      { action: 'log_biometrics', entry_date: '2026-08-20', weight: 80 },
      opts
    );
    expect(clearUserTdeeCache).toHaveBeenCalledTimes(1);

    vi.mocked(measurementService.getCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
      entry_date: '2026-08-20',
      weight: 81,
    });
    vi.mocked(measurementService.updateCheckInMeasurements).mockResolvedValue({
      id: 'ci-1',
    });
    await tools.sparky_manage_checkin.execute!(
      { action: 'update_checkin', entry_date: '2026-08-20', weight: 80 },
      opts
    );
    expect(clearUserTdeeCache).toHaveBeenCalledTimes(2);

    vi.mocked(measurementService.deleteCheckInMeasurements).mockResolvedValue({
      message: 'Check-in measurement deleted successfully.',
    });
    await tools.sparky_manage_checkin.execute!(
      { action: 'delete_checkin_entry', entry_date: '2026-08-20' },
      opts
    );
    expect(clearUserTdeeCache).toHaveBeenCalledTimes(3);
  });

  it('never infers delete_checkin_entry from a bare entry_date', async () => {
    mockEmptyDiary();

    const result = await tools.sparky_manage_checkin.execute!(
      { entry_date: '2026-08-20' },
      opts
    );

    expect(result).toContain('Check-in Diary');
    expect(measurementService.deleteCheckInMeasurements).not.toHaveBeenCalled();
  });
});
