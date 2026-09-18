import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockDbClient,
  type MockDbClient,
} from './helpers/mockDbClient.js';
import checkInPhotoService from '../services/checkInPhotoService.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
}));

// upsertPhoto writes the image before committing; the suite is about what is
// written to the row, so the filesystem is stubbed out entirely.
vi.mock('fs', () => ({
  default: {
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe('checkInPhotoService.getAllPhotosWithWeight', () => {
  let mockClient: MockDbClient;

  const withRows = (rows: unknown[]) => {
    mockClient.query.mockResolvedValue({ rows });
  };

  beforeEach(() => {
    mockClient = createMockDbClient([]);
    // @ts-expect-error mock typing
    getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const sqlOf = () => mockClient.query.mock.calls[0][0] as string;
  const paramsOf = () => mockClient.query.mock.calls[0][1] as unknown[];

  it('joins the weight on (user_id, entry_date), not the measurement FK', async () => {
    await checkInPhotoService.getAllPhotosWithWeight('user-1');

    const sql = sqlOf().replace(/\s+/g, ' ');
    expect(sql).toContain('LEFT JOIN check_in_measurements m');
    expect(sql).toContain(
      'ON m.user_id = p.user_id AND m.entry_date = p.entry_date'
    );
    // The stored FK is only populated when a measurement row already existed at
    // upload time, so joining on it would report no weight forever for a photo
    // taken before that day's weight was entered.
    expect(sql).not.toContain('check_in_measurement_id');
    expect(paramsOf()).toEqual(['user-1']);
  });

  it('scopes the query to the caller and orders newest day first', async () => {
    await checkInPhotoService.getAllPhotosWithWeight('user-1');

    const sql = sqlOf().replace(/\s+/g, ' ');
    expect(sql).toContain('WHERE p.user_id = $1');
    expect(sql).toContain('ORDER BY p.entry_date DESC');
    expect(getClient).toHaveBeenCalledWith('user-1');
  });

  it('reports a null weight as null rather than NaN', async () => {
    withRows([
      { id: 'a', entry_date: '2026-03-01', photo_type: 'front', weight: null },
      {
        id: 'b',
        entry_date: '2026-03-01',
        photo_type: 'side',
        weight: undefined,
      },
    ]);

    const photos = await checkInPhotoService.getAllPhotosWithWeight('user-1');

    expect(photos[0].weight).toBeNull();
    expect(photos[1].weight).toBeNull();
  });

  it('keeps a real weight numeric, including zero', async () => {
    withRows([
      {
        id: 'a',
        entry_date: '2026-03-01',
        photo_type: 'front',
        weight: '82.4',
      },
      { id: 'b', entry_date: '2026-03-02', photo_type: 'front', weight: 0 },
    ]);

    const photos = await checkInPhotoService.getAllPhotosWithWeight('user-1');

    expect(photos[0].weight).toBe(82.4);
    // 0 is falsy but is a legitimate stored value, so it must survive the
    // null guard rather than being flattened to null.
    expect(photos[1].weight).toBe(0);
  });

  /**
   * pg hands back a Date for a `date` column. Formatting it through
   * toISOString() reports the UTC day, which is the wrong calendar day whenever
   * the offset pushes the instant across midnight — the photo would then pair
   * with the neighbouring day's weight.
   *
   * Two rows, because the shift goes opposite ways either side of Greenwich: a
   * late local evening rolls forward in UTC only for western offsets, an early
   * local morning rolls backward only for eastern ones. Between them one of the
   * two catches the bug in any zone with a non-zero offset. At UTC itself
   * neither can, so this file is also run under explicit zones:
   *
   *   TZ=America/Los_Angeles pnpm exec vitest run tests/checkInPhotoService.test.ts
   *   TZ=Pacific/Auckland pnpm exec vitest run tests/checkInPhotoService.test.ts
   */
  it('normalizes a Date entry_date to its local calendar day', async () => {
    const lateEvening = new Date(2026, 2, 15, 23, 30);
    const earlyMorning = new Date(2026, 2, 20, 0, 30);
    withRows([
      { id: 'a', entry_date: lateEvening, photo_type: 'front', weight: 80 },
      { id: 'b', entry_date: earlyMorning, photo_type: 'front', weight: 80 },
    ]);

    const photos = await checkInPhotoService.getAllPhotosWithWeight('user-1');

    expect(photos[0].entry_date).toBe('2026-03-15');
    expect(photos[1].entry_date).toBe('2026-03-20');
  });

  it('passes a string entry_date through untouched', async () => {
    withRows([
      { id: 'a', entry_date: '2026-03-15', photo_type: 'front', weight: 80 },
    ]);

    const photos = await checkInPhotoService.getAllPhotosWithWeight('user-1');

    expect(photos[0].entry_date).toBe('2026-03-15');
  });

  it('omits file_path so the on-disk layout stays a server detail', async () => {
    withRows([
      {
        id: 'a',
        entry_date: '2026-03-15',
        photo_type: 'front',
        weight: 80,
        file_path: 'uploads/check-in/user-1/2026-03-15/front.jpg',
      },
    ]);

    const photos = await checkInPhotoService.getAllPhotosWithWeight('user-1');

    expect(photos[0]).toEqual({
      id: 'a',
      entry_date: '2026-03-15',
      photo_type: 'front',
      weight: 80,
    });
    expect(sqlOf()).not.toContain('file_path');
  });

  it('releases the client even when the query throws', async () => {
    mockClient.query.mockRejectedValue(new Error('connection lost'));

    await expect(
      checkInPhotoService.getAllPhotosWithWeight('user-1')
    ).rejects.toThrow('connection lost');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

describe('checkInPhotoService.upsertPhoto capture conditions', () => {
  let mockClient: MockDbClient;

  const CAPTURE_META = {
    v: 1 as const,
    capture_mode: 'guided' as const,
    facing: 'front' as const,
    timer_seconds: 3,
    local_time: '2026-06-14T07:12:00-05:00',
  };

  beforeEach(() => {
    mockClient = createMockDbClient([]);
    // The INSERT is the only statement whose result is read; every other call
    // in the transaction is happy with no rows.
    mockClient.query.mockImplementation((sql: string) => {
      if (
        typeof sql === 'string' &&
        sql.includes('INSERT INTO check_in_photos')
      ) {
        return Promise.resolve({
          rows: [
            {
              id: 'photo-1',
              user_id: 'user-1',
              check_in_measurement_id: null,
              entry_date: '2026-06-14',
              photo_type: 'front',
              file_path: 'uploads/check-in/user-1/2026-06-14/front.jpg',
              created_at: '2026-06-14T10:00:00.000Z',
              capture_meta: CAPTURE_META,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    // @ts-expect-error mock typing
    getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const insertCall = () =>
    mockClient.query.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT INTO check_in_photos')
    ) as [string, unknown[]];

  it('serializes the conditions to JSON for the jsonb column', async () => {
    await checkInPhotoService.upsertPhoto(
      'user-1',
      '2026-06-14',
      'front',
      'jpg',
      Buffer.from([0xff, 0xd8, 0xff]),
      CAPTURE_META
    );

    expect(insertCall()[1][5]).toBe(JSON.stringify(CAPTURE_META));
  });

  it('stores SQL NULL, not the string "null", when there are no conditions', async () => {
    // JSON.stringify(null) is the four-character string "null", which postgres
    // would happily accept into a jsonb column as a JSON null literal. A later
    // comparison would then read conditions that exist but say nothing, rather
    // than a row it can recognise as unknown.
    await checkInPhotoService.upsertPhoto(
      'user-1',
      '2026-06-14',
      'front',
      'jpg',
      Buffer.from([0xff, 0xd8, 0xff])
    );

    expect(insertCall()[1][5]).toBeNull();
  });

  it('replaces the conditions when an angle is re-shot', async () => {
    // ON CONFLICT must take EXCLUDED.capture_meta: the row describes the photo
    // that is there now, so keeping the previous shot's framing would misreport
    // how the current one was taken.
    await checkInPhotoService.upsertPhoto(
      'user-1',
      '2026-06-14',
      'front',
      'jpg',
      Buffer.from([0xff, 0xd8, 0xff]),
      CAPTURE_META
    );

    const sql = insertCall()[0].replace(/\s+/g, ' ');
    expect(sql).toContain('capture_meta = EXCLUDED.capture_meta');
  });
});
