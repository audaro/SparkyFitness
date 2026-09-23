import fs from 'fs';
import path from 'path';
import { getClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import { localDateToDay, daysBetween as dayGap } from '@workspace/shared';
import {
  assessComparability,
  ratioDeltas,
  unreliableRatios,
  photoMetricsSchema,
  storedDeterministicSchema,
  type AlignedPair,
  type BodyRatios,
  type ComparabilityOutcome,
  type ComparisonDeterministic,
  type ComparisonResponse,
  type StoredDeterministic,
} from '@workspace/shared';
import {
  comparePhotos,
  isVisionConfigured,
  VisionServiceError,
  type VisionComparison,
  type VisionImage,
} from '../integrations/vision/visionService.js';
import checkInPhotoService from './checkInPhotoService.js';

/** Thrown when the request itself is wrong, as opposed to the photos. */
export class ComparisonRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ComparisonRequestError';
    this.status = status;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

interface PhotoRow {
  id: string;
  entry_date: string;
  photo_type: string;
}

/**
 * Load a photo's row through the user's RLS-scoped client.
 *
 * This is what proves the caller may see the photo at all: a row that RLS
 * hides is indistinguishable from one that does not exist, which is exactly
 * the answer the caller should get.
 */
const loadPhotoRow = async (
  userId: string,
  photoId: string
): Promise<PhotoRow> => {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      'SELECT id, entry_date, photo_type FROM check_in_photos WHERE id = $1',
      [photoId]
    );
    if (result.rows.length === 0) {
      throw new ComparisonRequestError(404, `Photo ${photoId} not found`);
    }
    const found = result.rows[0];
    return {
      id: String(found.id),
      entry_date:
        found.entry_date instanceof Date
          ? localDateToDay(found.entry_date)
          : String(found.entry_date),
      photo_type: String(found.photo_type),
    };
  } finally {
    client.release();
  }
};

/**
 * Read a photo's bytes.
 *
 * Deliberately separate from the row, and called only once a comparison is
 * actually going to be measured: a cached pair would otherwise pull two
 * multi-megabyte files off disk to answer from a row it already has.
 */
const loadPhotoImage = async (
  userId: string,
  photoId: string
): Promise<VisionImage> => {
  const absolute = await checkInPhotoService.getPhotoFileById(userId, photoId);
  if (!absolute) {
    // The row exists but the file behind it does not. Loud, because the
    // alternative is a comparison built from one photo and a guess.
    throw new ComparisonRequestError(
      404,
      `Photo ${photoId} has no readable image file`
    );
  }
  const extension = path.extname(absolute).toLowerCase();
  return {
    bytes: await fs.promises.readFile(absolute),
    filename: path.basename(absolute),
    contentType: CONTENT_TYPES[extension] || 'application/octet-stream',
  };
};

/**
 * Fold the sidecar's response into the shape that gets stored.
 *
 * Note what is dropped: the landmarks, which are cached per photo instead, the
 * aligned JPEGs, which are never stored at all, and `unreliable_ratios`, which
 * `readDeterministic` recomputes on the way back out.
 */
const toDeterministic = (comparison: VisionComparison): StoredDeterministic => {
  // Parsed, not trusted: the deltas are computed from what the contract
  // accepted rather than from the raw payload, so a sidecar that starts
  // sending a different shape fails here instead of producing a number.
  const before = photoMetricsSchema.parse(comparison.before.metrics);
  const after = photoMetricsSchema.parse(comparison.after.metrics);
  return {
    before,
    after,
    alignment: comparison.alignment,
    exposure: comparison.exposure,
    ratio_deltas: ratioDeltas(before.ratios, after.ratios),
    engine: comparison.engine,
  };
};

/**
 * The verdict for a stored row.
 *
 * Recomputed on every read rather than stored: the thresholds live in
 * `@workspace/shared` and will be tuned as real pairs accumulate, and a
 * verdict written into the database would still be answering last month's
 * question.
 */
const verdictFor = (
  deterministic: ComparisonDeterministic | null,
  failureReason: string | null
): ComparabilityOutcome => {
  if (!deterministic) {
    // `failure_reason` is set when the sidecar refused the photo; its absence
    // here means the row held measurements this code could not read, which is
    // an absent analysis rather than an absent body.
    return {
      verdict: 'not_comparable',
      reasons: [failureReason ? 'pose_not_detected' : 'not_analyzed'],
    };
  }
  const measured = Object.keys(deterministic.ratio_deltas);
  return assessComparability({
    ...deterministic,
    trustworthy_ratios: measured.filter(
      (key) =>
        !deterministic.unreliable_ratios.includes(key as keyof BodyRatios)
    ),
  });
};

/**
 * Rebuild the full response shape from what the row actually holds.
 *
 * Two things happen here rather than at write time. `unreliable_ratios` is
 * recomputed from the stored `arms_overlap` flags, so rows written before that
 * rule existed - or before it last changed - are graded by today's rule rather
 * than carrying a stale answer or, worse, no answer at all where the type
 * promises one.
 *
 * And it is intersected with the deltas that actually exist. A ratio neither
 * photo could compute is absent from `ratio_deltas`, and naming it as
 * untrustworthy would be a caveat attached to nothing - a caller walking the
 * list to mark up numbers would look for one that was never there.
 */
const readDeterministic = (raw: unknown): ComparisonDeterministic | null => {
  if (raw === null || raw === undefined) return null;
  const parsed = storedDeterministicSchema.safeParse(raw);
  if (!parsed.success) {
    // A row this code cannot read is treated as having no measurements rather
    // than partially decoded into numbers of unknown provenance. Loud, because
    // it means a stored shape and this schema have diverged, and the row needs
    // re-measuring (POST with `force`) rather than displaying.
    log(
      'error',
      '[progressPhotoComparison] Stored measurements do not match the schema; treating the pair as unmeasured',
      parsed.error.issues[0]
    );
    return null;
  }
  const stored = parsed.data;
  const unreliable = unreliableRatios(stored.before, stored.after);
  const measured = new Set(Object.keys(stored.ratio_deltas));
  return {
    ...stored,
    unreliable_ratios: unreliable.filter((key) => measured.has(key)),
  };
};

/** Cache both photos' measurements as a by-product of a comparison. */
const cacheAnalyses = async (
  userId: string,
  beforeId: string,
  afterId: string,
  comparison: VisionComparison
): Promise<void> => {
  const client = await getClient(userId);
  try {
    for (const [photoId, analysis] of [
      [beforeId, comparison.before],
      [afterId, comparison.after],
    ] as const) {
      await client.query(
        `INSERT INTO check_in_photo_analysis
           (user_id, photo_id, engine, metrics, landmarks, failure_reason)
         VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (photo_id) DO UPDATE SET
           engine = EXCLUDED.engine,
           metrics = EXCLUDED.metrics,
           landmarks = EXCLUDED.landmarks,
           failure_reason = NULL,
           updated_at = now()`,
        [
          userId,
          photoId,
          analysis.engine,
          JSON.stringify(analysis.metrics),
          JSON.stringify(analysis.landmarks),
        ]
      );
    }
  } catch (err) {
    // This is a cache. Failing to fill it must not fail the comparison the
    // user actually asked for.
    log(
      'warn',
      '[progressPhotoComparison] Failed to cache photo analyses',
      err
    );
  } finally {
    client.release();
  }
};

const rowToResponse = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  gapInDays: number
): ComparisonResponse => {
  const deterministic = readDeterministic(row.deterministic);
  const outcome = verdictFor(deterministic, row.failure_reason ?? null);
  return {
    id: String(row.id),
    before_photo_id: String(row.before_photo_id),
    after_photo_id: String(row.after_photo_id),
    days_between: gapInDays,
    verdict: outcome.verdict,
    reasons: outcome.reasons,
    deterministic,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
};

const gapInDays = (beforeDate: string, afterDate: string): number =>
  Math.abs(dayGap(beforeDate, afterDate));

/**
 * Compare two photos, measuring them if this pair has not been seen before.
 *
 * Idempotent: the same pair returns the same row, and a re-request only costs
 * a database read. `force` re-measures, which is what a sidecar upgrade needs.
 */
export const createComparison = async (
  userId: string,
  beforePhotoId: string,
  afterPhotoId: string,
  force = false
): Promise<ComparisonResponse> => {
  if (beforePhotoId === afterPhotoId) {
    throw new ComparisonRequestError(
      400,
      'A photo cannot be compared against itself'
    );
  }
  if (!isVisionConfigured()) {
    throw new ComparisonRequestError(
      503,
      'Photo comparison is not configured on this server'
    );
  }

  const beforeRow = await loadPhotoRow(userId, beforePhotoId);
  const afterRow = await loadPhotoRow(userId, afterPhotoId);

  if (beforeRow.photo_type !== afterRow.photo_type) {
    // A front view against a side view produces perfectly real numbers that
    // mean nothing at all, and they would read as a dramatic change.
    throw new ComparisonRequestError(
      400,
      `Photos must be the same angle (got ${beforeRow.photo_type} and ${afterRow.photo_type})`
    );
  }

  if (dayGap(beforeRow.entry_date, afterRow.entry_date) <= 0) {
    // "Before" and "after" are not labels the caller gets to choose freely:
    // every delta downstream is after minus before, so a reversed pair would
    // report a gain as a loss with no sign that anything was wrong.
    throw new ComparisonRequestError(
      400,
      'The before photo must have been taken before the after photo'
    );
  }

  const between = gapInDays(beforeRow.entry_date, afterRow.entry_date);

  if (!force) {
    const existing = await findComparison(userId, beforePhotoId, afterPhotoId);
    if (existing) return existing;
  }

  const beforeImage = await loadPhotoImage(userId, beforePhotoId);
  const afterImage = await loadPhotoImage(userId, afterPhotoId);

  let deterministic: StoredDeterministic | null = null;
  let failureReason: string | null = null;
  let engine = 'unknown';
  let comparison: VisionComparison | null = null;

  try {
    comparison = await comparePhotos(beforeImage, afterImage);
    deterministic = toDeterministic(comparison);
    engine = comparison.engine;
  } catch (err) {
    if (err instanceof VisionServiceError && err.isPhotoProblem) {
      // The photo is the problem, and that is a durable fact worth caching:
      // re-running the model on the same unusable photo will not find a body
      // the second time either.
      failureReason = err.reason;
    } else {
      // The service is the problem. Nothing is cached, because the next
      // attempt may well succeed.
      throw err;
    }
  }

  const client = await getClient(userId);
  let stored;
  try {
    const result = await client.query(
      `INSERT INTO progress_photo_comparisons
         (user_id, before_photo_id, after_photo_id, engine, deterministic, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, before_photo_id, after_photo_id) DO UPDATE SET
         engine = EXCLUDED.engine,
         deterministic = EXCLUDED.deterministic,
         failure_reason = EXCLUDED.failure_reason,
         updated_at = now()
       RETURNING *`,
      [
        userId,
        beforePhotoId,
        afterPhotoId,
        engine,
        deterministic ? JSON.stringify(deterministic) : null,
        failureReason,
      ]
    );
    stored = result.rows[0];
  } finally {
    client.release();
  }
  if (!stored) {
    // ON CONFLICT DO UPDATE ... RETURNING * always yields a row, so this means
    // something about the statement has changed. Say so rather than letting a
    // missing row become an undefined verdict two frames later.
    throw new Error('Comparison insert returned no row');
  }

  if (comparison) {
    await cacheAnalyses(userId, beforePhotoId, afterPhotoId, comparison);
  }

  return rowToResponse(stored, between);
};

const entryDates = async (
  userId: string,
  photoIds: string[]
): Promise<Map<string, string>> => {
  if (photoIds.length === 0) return new Map();
  const client = await getClient(userId);
  try {
    const result = await client.query(
      'SELECT id, entry_date FROM check_in_photos WHERE id = ANY($1::uuid[])',
      [photoIds]
    );
    return new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.rows.map((r: any) => [
        String(r.id),
        r.entry_date instanceof Date
          ? localDateToDay(r.entry_date)
          : String(r.entry_date),
      ])
    );
  } finally {
    client.release();
  }
};

/**
 * Attach `days_between` to rows, reading both photos' dates in one query.
 *
 * A pair whose photos are no longer both visible is dropped rather than
 * reported with a zero gap — the alternative is a list entry claiming two
 * photos were taken on the same day.
 */
const withDates = async (
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[]
): Promise<ComparisonResponse[]> => {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [String(r.before_photo_id), String(r.after_photo_id)])
    ),
  ];
  const dates = await entryDates(userId, ids);
  const responses: ComparisonResponse[] = [];
  for (const row of rows) {
    const beforeDate = dates.get(String(row.before_photo_id));
    const afterDate = dates.get(String(row.after_photo_id));
    if (!beforeDate || !afterDate) continue;
    responses.push(rowToResponse(row, gapInDays(beforeDate, afterDate)));
  }
  return responses;
};

export const findComparison = async (
  userId: string,
  beforePhotoId: string,
  afterPhotoId: string
): Promise<ComparisonResponse | null> => {
  const client = await getClient(userId);
  let rows;
  try {
    const result = await client.query(
      `SELECT * FROM progress_photo_comparisons
       WHERE user_id = $1 AND before_photo_id = $2 AND after_photo_id = $3`,
      [userId, beforePhotoId, afterPhotoId]
    );
    rows = result.rows;
  } finally {
    client.release();
  }
  if (rows.length === 0) return null;
  const [response] = await withDates(userId, rows);
  return response ?? null;
};

export const getComparisonById = async (
  userId: string,
  comparisonId: string
): Promise<ComparisonResponse | null> => {
  const client = await getClient(userId);
  let rows;
  try {
    const result = await client.query(
      'SELECT * FROM progress_photo_comparisons WHERE id = $1',
      [comparisonId]
    );
    rows = result.rows;
  } finally {
    client.release();
  }
  if (rows.length === 0) return null;
  const [response] = await withDates(userId, rows);
  return response ?? null;
};

/**
 * Both frames of a stored comparison, warped into one geometry.
 *
 * Read-only on purpose: this re-runs the sidecar to produce pixels and does
 * NOT write the numbers it gets back. A viewing should not silently re-measure
 * a pair — if a sidecar upgrade should change the stored measurements, that is
 * what `POST` with `force` is for, and it is a thing the user asked for rather
 * than a side effect of opening a slider.
 */
export const getAlignedPair = async (
  userId: string,
  comparisonId: string
): Promise<AlignedPair> => {
  if (!isVisionConfigured()) {
    throw new ComparisonRequestError(
      503,
      'Photo comparison is not configured on this server'
    );
  }

  const comparison = await getComparisonById(userId, comparisonId);
  if (!comparison) {
    throw new ComparisonRequestError(404, 'Comparison not found');
  }
  if (!comparison.deterministic) {
    // The stored row already records that one of these photos could not be
    // measured. Re-running the model on the same two files to rediscover that
    // would cost a round trip to reach the same refusal.
    throw new ComparisonRequestError(
      422,
      'This pair could not be measured, so there is nothing to align'
    );
  }

  const [beforeImage, afterImage] = await Promise.all([
    loadPhotoImage(userId, comparison.before_photo_id),
    loadPhotoImage(userId, comparison.after_photo_id),
  ]);

  const aligned = await comparePhotos(beforeImage, afterImage, true);
  if (!aligned.aligned_before_jpeg || !aligned.aligned_after_jpeg) {
    // The sidecar answered but did not include what was asked for. Loud,
    // because the alternative is a slider rendering one frame twice, which
    // looks exactly like a body that did not change.
    throw new VisionServiceError(
      'aligned_frames_missing',
      false,
      'Vision service returned a comparison without the aligned frames'
    );
  }

  return {
    before_jpeg: aligned.aligned_before_jpeg,
    after_jpeg: aligned.aligned_after_jpeg,
    // The before photo is the frame the other was fitted to, so its own size
    // is the size of both.
    frame: photoMetricsSchema.parse(aligned.before.metrics).image_size,
    engine: aligned.engine,
  };
};

export const listComparisons = async (
  userId: string,
  limit = 50
): Promise<ComparisonResponse[]> => {
  const client = await getClient(userId);
  let rows;
  try {
    const result = await client.query(
      `SELECT * FROM progress_photo_comparisons
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    rows = result.rows;
  } finally {
    client.release();
  }
  return withDates(userId, rows);
};

export default {
  createComparison,
  findComparison,
  getAlignedPair,
  getComparisonById,
  listComparisons,
};
