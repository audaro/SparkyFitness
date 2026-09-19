import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockDbClient,
  type MockDbClient,
} from './helpers/mockDbClient.js';
import { getClient } from '../db/poolManager.js';
import comparisonService, {
  ComparisonRequestError,
} from '../services/progressPhotoComparisonService.js';
import checkInPhotoService from '../services/checkInPhotoService.js';
import {
  comparePhotos,
  isVisionConfigured,
  VisionServiceError,
} from '../integrations/vision/visionService.js';

vi.mock('../db/poolManager', () => ({ getClient: vi.fn() }));
vi.mock('../services/checkInPhotoService.js', () => ({
  default: { getPhotoFileById: vi.fn() },
}));
vi.mock('../integrations/vision/visionService.js', async () => {
  const actual = await import('../integrations/vision/visionService.js');
  return {
    ...actual,
    comparePhotos: vi.fn(),
    isVisionConfigured: vi.fn(() => true),
  };
});
vi.mock('fs', () => ({
  default: {
    promises: {
      readFile: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8])),
    },
  },
}));

const BEFORE_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const AFTER_ID = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';

const noArms = {
  shoulder: false,
  chest: false,
  waist: false,
  hip: false,
  thigh: false,
};

const metrics = (waistShoulder: number) => ({
  height_px: 1000,
  image_size: [900, 1600],
  widths_px: { shoulder: 300, chest: 280, waist: 220, hip: 260, thigh: 150 },
  arms_overlap: noArms,
  ratios: {
    waist_shoulder: waistShoulder,
    waist_height: 0.22,
    hip_shoulder: 0.86,
    shoulder_height: 0.3,
    thigh_height: 0.15,
    mask_area_height2: 0.2,
  },
  background: { luminance: 180, chroma: 4 },
  visibility: { eyes: 0.99, shoulders: 0.98, hips: 0.95, ankles: 0.9 },
});

/**
 * A stored `deterministic` blob, as the column actually holds one.
 *
 * `unreliable_ratios` is deliberately absent: it is not stored, and a row
 * written before it existed looks exactly like this.
 */
const storedDeterministic = (
  overrides: {
    residual_norm?: number;
    armsOnBefore?: Partial<Record<string, boolean>>;
    armsOnBoth?: Partial<Record<string, boolean>>;
    ratio_deltas?: Record<string, number>;
  } = {}
) => ({
  before: {
    ...metrics(0.75),
    arms_overlap: {
      ...noArms,
      ...(overrides.armsOnBoth ?? {}),
      ...(overrides.armsOnBefore ?? {}),
    },
  },
  after: {
    ...metrics(0.7),
    arms_overlap: { ...noArms, ...(overrides.armsOnBoth ?? {}) },
  },
  alignment: {
    residual_px: 6,
    residual_norm: overrides.residual_norm ?? 0.006,
    scale: 1.01,
  },
  exposure: { luminance_delta: 2, chroma_delta: 0.4, corrected: true },
  ratio_deltas: overrides.ratio_deltas ?? {
    waist_shoulder: -0.05,
    hip_shoulder: 0.01,
    shoulder_height: 0.001,
    thigh_height: 0.002,
    mask_area_height2: -0.001,
  },
  engine: 'mediapipe-0.10.35/pose_landmarker_heavy/metrics-1',
});

const visionResult = {
  engine: 'mediapipe-0.10.35/pose_landmarker_heavy/metrics-1',
  before: { engine: 'e', metrics: metrics(0.75), landmarks: [[1, 2, 0.9]] },
  after: { engine: 'e', metrics: metrics(0.7), landmarks: [[1, 2, 0.9]] },
  alignment: { residual_px: 6, residual_norm: 0.006, scale: 1.01 },
  exposure: { luminance_delta: 2, chroma_delta: 0.4, corrected: true },
};

describe('progressPhotoComparisonService.createComparison', () => {
  let mockClient: MockDbClient;
  /** Rows the next queries return, in order. */
  let queue: unknown[][];

  const photoRow = (id: string, date: string, type = 'front') => ({
    id,
    entry_date: date,
    photo_type: type,
  });

  beforeEach(() => {
    queue = [];
    mockClient = createMockDbClient([]);
    mockClient.query.mockImplementation(() =>
      Promise.resolve({ rows: queue.shift() ?? [] })
    );
    // @ts-expect-error mock typing
    getClient.mockResolvedValue(mockClient);
    vi.mocked(checkInPhotoService.getPhotoFileById).mockResolvedValue(
      '/uploads/check-in/u/2026-01-01/front.jpg'
    );
    vi.mocked(isVisionConfigured).mockReturnValue(true);
    vi.mocked(comparePhotos).mockResolvedValue(visionResult as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** before lookup, after lookup, cache miss, insert returning the row. */
  const happyPathQueue = (
    beforeDate = '2026-01-01',
    afterDate = '2026-03-01',
    afterType = 'front'
  ) => {
    queue = [
      [photoRow(BEFORE_ID, beforeDate)],
      [photoRow(AFTER_ID, afterDate, afterType)],
      [],
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: null,
          failure_reason: null,
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
    ];
  };

  it('refuses to compare a photo with itself', async () => {
    await expect(
      comparisonService.createComparison('u', BEFORE_ID, BEFORE_ID)
    ).rejects.toThrow(ComparisonRequestError);
    expect(comparePhotos).not.toHaveBeenCalled();
  });

  it('refuses two different angles', async () => {
    // A front view against a side view produces perfectly real numbers that
    // mean nothing, and they would read as a dramatic change.
    queue = [
      [photoRow(BEFORE_ID, '2026-01-01', 'front')],
      [photoRow(AFTER_ID, '2026-03-01', 'side')],
    ];

    await expect(
      comparisonService.createComparison('u', BEFORE_ID, AFTER_ID)
    ).rejects.toThrow(/same angle/);
    expect(comparePhotos).not.toHaveBeenCalled();
  });

  it('refuses a pair given in the wrong order', async () => {
    // Every delta is after minus before, so a reversed pair would report a
    // gain as a loss with nothing to show anything went wrong.
    queue = [
      [photoRow(BEFORE_ID, '2026-03-01')],
      [photoRow(AFTER_ID, '2026-01-01')],
    ];

    await expect(
      comparisonService.createComparison('u', BEFORE_ID, AFTER_ID)
    ).rejects.toThrow(/before the after photo/);
    expect(comparePhotos).not.toHaveBeenCalled();
  });

  it('refuses when the row exists but the file does not', async () => {
    // Loud, because the alternative is a comparison built from one photo.
    happyPathQueue();
    vi.mocked(checkInPhotoService.getPhotoFileById).mockResolvedValue(null);

    await expect(
      comparisonService.createComparison('u', BEFORE_ID, AFTER_ID)
    ).rejects.toThrow(/no readable image file/);
  });

  it('refuses when the vision service is not configured', async () => {
    vi.mocked(isVisionConfigured).mockReturnValue(false);

    await expect(
      comparisonService.createComparison('u', BEFORE_ID, AFTER_ID)
    ).rejects.toMatchObject({ status: 503 });
  });

  it('answers a cached pair without reading the photos off disk', async () => {
    // Two multi-megabyte files, on every view of a comparison that has not
    // changed since it was measured.
    queue = [
      [photoRow(BEFORE_ID, '2026-01-01')],
      [photoRow(AFTER_ID, '2026-03-01')],
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: storedDeterministic({ residual_norm: 0.001 }),
          failure_reason: null,
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      [
        { id: BEFORE_ID, entry_date: '2026-01-01' },
        { id: AFTER_ID, entry_date: '2026-03-01' },
      ],
    ];

    const result = await comparisonService.createComparison(
      'u',
      BEFORE_ID,
      AFTER_ID
    );

    expect(result.verdict).toBe('comparable');
    expect(checkInPhotoService.getPhotoFileById).not.toHaveBeenCalled();
    expect(comparePhotos).not.toHaveBeenCalled();
  });

  it('stores the measurements and the day gap', async () => {
    happyPathQueue('2026-01-01', '2026-03-01');

    const result = await comparisonService.createComparison(
      'u',
      BEFORE_ID,
      AFTER_ID
    );

    expect(result.days_between).toBe(59);
    const insert = mockClient.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO progress_photo_comparisons')
    );
    const stored = JSON.parse(String(insert?.[1]?.[4]));
    expect(stored.ratio_deltas.waist_shoulder).toBeCloseTo(-0.05, 10);
    expect(stored.alignment.residual_norm).toBe(0.006);
    // The aligned JPEGs and the landmarks are deliberately not in here: the
    // first are never stored at all, the second are cached per photo.
    expect(stored).not.toHaveProperty('aligned_after_jpeg');
    expect(stored.before).not.toHaveProperty('landmarks');
  });

  it('caches an unusable photo instead of re-running the model on it', async () => {
    // A photo with no whole body in it will not grow one on the second try.
    happyPathQueue();
    vi.mocked(comparePhotos).mockRejectedValue(
      new VisionServiceError('landmark_not_visible:ankles', true)
    );

    await comparisonService.createComparison('u', BEFORE_ID, AFTER_ID);

    const insert = mockClient.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO progress_photo_comparisons')
    );
    expect(insert?.[1]?.[4]).toBeNull();
    expect(insert?.[1]?.[5]).toBe('landmark_not_visible:ankles');
  });

  it('caches nothing when the service itself is down', async () => {
    // The next attempt may well succeed; writing a failure row would make a
    // transient outage permanent for that pair.
    happyPathQueue();
    vi.mocked(comparePhotos).mockRejectedValue(
      new VisionServiceError('ECONNREFUSED', false)
    );

    await expect(
      comparisonService.createComparison('u', BEFORE_ID, AFTER_ID)
    ).rejects.toThrow(VisionServiceError);

    const insert = mockClient.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO progress_photo_comparisons')
    );
    expect(insert).toBeUndefined();
  });

  it('recomputes the verdict from the stored numbers rather than reading one', async () => {
    // Nothing writes a verdict column, so a threshold change in
    // @workspace/shared reaches pairs measured months ago.
    queue = [
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: storedDeterministic({ residual_norm: 0.2 }),
          failure_reason: null,
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      [
        { id: BEFORE_ID, entry_date: '2026-01-01' },
        { id: AFTER_ID, entry_date: '2026-03-01' },
      ],
    ];

    const result = await comparisonService.getComparisonById('u', 'x');

    expect(result?.verdict).toBe('not_comparable');
    expect(result?.reasons).toEqual(['alignment_residual']);
  });

  it('grades a row written before unreliable_ratios existed', async () => {
    // The column never held the field, and it was not backfilled: it is
    // recomputed from the arms_overlap flags the row already stores. A cached
    // pair from last month therefore arrives with today's rule applied rather
    // than with an absent array the response type promises is there.
    queue = [
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: storedDeterministic({ armsOnBoth: { waist: true } }),
          failure_reason: null,
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      [
        { id: BEFORE_ID, entry_date: '2026-01-01' },
        { id: AFTER_ID, entry_date: '2026-03-01' },
      ],
    ];

    const result = await comparisonService.getComparisonById('u', 'x');

    expect(result?.deterministic?.unreliable_ratios).toEqual([
      'waist_shoulder',
    ]);
    // waist_height is contaminated too, but neither photo produced a delta for
    // it, so there is nothing for the caveat to attach to.
    expect(result?.deterministic?.ratio_deltas).not.toHaveProperty(
      'waist_height'
    );
    expect(result?.verdict).toBe('comparable');
  });

  it('refuses to half-read a stored shape it does not recognise', async () => {
    // Better an honest "no measurements", which the caller can re-request with
    // force, than numbers of unknown provenance dressed up as a comparison.
    queue = [
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: { alignment: { residual_norm: 0.001 } },
          failure_reason: null,
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      [
        { id: BEFORE_ID, entry_date: '2026-01-01' },
        { id: AFTER_ID, entry_date: '2026-03-01' },
      ],
    ];

    const result = await comparisonService.getComparisonById('u', 'x');

    expect(result?.deterministic).toBeNull();
    expect(result?.verdict).toBe('not_comparable');
    // Not pose_not_detected: a body was found, the row just cannot be read.
    expect(result?.reasons).toEqual(['not_analyzed']);
  });

  it('says a pair is not comparable when nothing measurable survives', async () => {
    // "Comparable" is a promise that something can be compared. With every
    // shape number struck out there is nothing behind the promise.
    queue = [
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: storedDeterministic({
            armsOnBoth: { waist: true, hip: true, shoulder: true },
            ratio_deltas: { waist_shoulder: -0.05, hip_shoulder: 0.01 },
          }),
          failure_reason: null,
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      [
        { id: BEFORE_ID, entry_date: '2026-01-01' },
        { id: AFTER_ID, entry_date: '2026-03-01' },
      ],
    ];

    const result = await comparisonService.getComparisonById('u', 'x');

    expect(result?.verdict).toBe('not_comparable');
    expect(result?.reasons).toEqual(['arms_obscured']);
  });

  it('drops a pair whose photos are no longer both visible', async () => {
    // Reporting it with a zero gap would claim the two were taken on the same
    // day.
    queue = [
      [
        {
          id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
          before_photo_id: BEFORE_ID,
          after_photo_id: AFTER_ID,
          deterministic: null,
          failure_reason: 'pose_not_detected',
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      [{ id: BEFORE_ID, entry_date: '2026-01-01' }],
    ];

    expect(await comparisonService.listComparisons('u')).toEqual([]);
  });
});
