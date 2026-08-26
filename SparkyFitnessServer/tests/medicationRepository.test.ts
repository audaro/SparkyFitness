import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import medicationRepository from '../models/medicationRepository.js';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
}));

describe('medicationRepository', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;
  const userId = uuidv4();
  const scheduleId = uuidv4();

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    // @ts-expect-error mocked in the module mock above
    getClient.mockResolvedValue(mockClient);
    mockClient.query.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('updateSchedule', () => {
    it('passes explicit nulls through to the SQL params', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: scheduleId, schedule_type_id: 'daily' }],
      });

      const result = await medicationRepository.updateSchedule(
        userId,
        scheduleId,
        {
          schedule_type_id: 'daily',
          time_of_day: '09:00',
          days_of_week: null,
          interval_days: null,
        }
      );

      const [sql, values] = mockClient.query.mock.calls[0];
      expect(sql).toContain('UPDATE medication_schedules');
      expect(sql).toContain('schedule_type_id = $3');
      expect(sql).toContain('time_of_day = $4');
      expect(sql).toContain('days_of_week = $5');
      expect(sql).toContain('interval_days = $6');
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      expect(values).toEqual([
        scheduleId,
        userId,
        'daily',
        '09:00',
        null,
        null,
      ]);
      expect(result).toEqual({ id: scheduleId, schedule_type_id: 'daily' });
    });

    it('returns the current row without updating on an empty patch', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: scheduleId }],
      });

      const result = await medicationRepository.updateSchedule(
        userId,
        scheduleId,
        {}
      );

      const [sql, values] = mockClient.query.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).not.toContain('UPDATE');
      expect(values).toEqual([scheduleId, userId]);
      expect(result).toEqual({ id: scheduleId });
    });

    it('produces no SET clause for omitted custom_fields and source', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: scheduleId }],
      });

      await medicationRepository.updateSchedule(userId, scheduleId, {
        time_of_day: '07:30',
        source: 'sneaky',
      });

      const [sql, values] = mockClient.query.mock.calls[0];
      expect(sql).not.toContain('custom_fields =');
      expect(sql).not.toContain('source =');
      expect(values).toEqual([scheduleId, userId, '07:30']);
    });

    it('returns null when the schedule does not exist for the user', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      const result = await medicationRepository.updateSchedule(
        userId,
        scheduleId,
        { active: false }
      );
      expect(result).toBeNull();
    });
  });

  describe('listMedications', () => {
    const medA = uuidv4();
    const medB = uuidv4();

    /** The three reads the list makes, in order: medications, schedules, last-taken. */
    const answerWith = (lastTakenRows: unknown[]) => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            { id: medA, name: 'Tirzepatide' },
            { id: medB, name: 'Testosterone' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: lastTakenRows });
    };

    it('reports when each medication was last taken', async () => {
      const takenAt = new Date('2026-08-24T09:00:00.000Z');
      answerWith([{ medication_id: medA, last_taken_at: takenAt }]);

      const rows = await medicationRepository.listMedications(userId);

      expect(rows[0].last_taken_at).toEqual(takenAt);
      // Explicitly null rather than absent: the clients rank on this field, and `undefined`
      // would make "never taken" indistinguishable from a row read by another endpoint.
      expect(rows[1].last_taken_at).toBeNull();
    });

    it('counts only doses that were actually taken', async () => {
      answerWith([]);
      await medicationRepository.listMedications(userId);

      const [sql, values] = mockClient.query.mock.calls[2];
      // A skipped or snoozed dose is evidence *against* use; counting one would rank a drug the
      // user keeps putting off above the one they take every morning.
      expect(sql).toContain("status IN ('taken', 'prn_taken')");
      expect(sql).toContain('MAX(taken_at)');
      expect(sql).toContain('GROUP BY medication_id');
      expect(values).toEqual([[medA, medB], userId]);
    });

    it('does not reorder the list itself', async () => {
      answerWith([{ medication_id: medB, last_taken_at: new Date() }]);
      const rows = await medicationRepository.listMedications(userId);

      // The medications page reads top to bottom and stays alphabetical. Recency ranks the name
      // search's tier 1 on the client, and nothing else.
      const [sql] = mockClient.query.mock.calls[0];
      expect(sql).toContain('ORDER BY is_active DESC, name ASC');
      expect(rows.map((row: { name: string }) => row.name)).toEqual([
        'Tirzepatide',
        'Testosterone',
      ]);
    });

    it('asks nothing about doses when the cabinet is empty', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      expect(await medicationRepository.listMedications(userId)).toEqual([]);
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });
});
