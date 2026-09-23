import http from 'http';
import https from 'https';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { log } from '../../config/logging.js';
import type {
  AlignmentSummary,
  ExposureSummary,
  PhotoMetrics,
} from '@workspace/shared';

/**
 * Client for `SparkyFitnessVision`, the pose/measurement sidecar.
 *
 * The service is optional. With `VISION_MICROSERVICE_URL` unset the whole
 * progress-photo comparison feature is simply absent, and every other part of
 * the app behaves exactly as it did before it existed — no default localhost
 * guess, because a silent connection refused on every photo view is worse than
 * a feature that openly reports itself as unconfigured.
 */
// Read per call rather than captured at import: this module is loaded during
// boot, before the server's own env loading has necessarily finished, and
// tests set the variable around individual cases.
const baseUrl = (): string =>
  (process.env.VISION_MICROSERVICE_URL || '').trim().replace(/\/+$/, '');

export const isVisionConfigured = (): boolean => baseUrl().length > 0;

const httpAgent = new http.Agent({ keepAlive: true, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 60000 });

const visionAxios = axios.create({
  httpAgent,
  httpsAgent,
  // Pose inference on a CPU-only box runs a few seconds per photo, and
  // /compare does two of them plus a warp.
  timeout: 60000,
});

/**
 * Thrown for every failure this client can produce, with a stable token.
 *
 * `reason` is the sidecar's own machine token (`pose_not_detected`,
 * `landmark_not_visible:ankles`) when the service answered, or a transport
 * token when it did not. Callers map it to advice; nothing above this ever
 * sees an axios error or invents a number to paper over one.
 */
export class VisionServiceError extends Error {
  readonly reason: string;
  /** True when the photo is at fault, false when the service is. */
  readonly isPhotoProblem: boolean;

  constructor(reason: string, isPhotoProblem: boolean, message?: string) {
    super(message || reason);
    this.name = 'VisionServiceError';
    this.reason = reason;
    this.isPhotoProblem = isPhotoProblem;
  }
}

export interface VisionAnalysis {
  engine: string;
  metrics: PhotoMetrics;
  /** (33, 3): x, y in pixels of the analysed frame, then visibility. */
  landmarks: number[][];
}

export interface VisionComparison {
  engine: string;
  before: VisionAnalysis;
  after: VisionAnalysis;
  alignment: AlignmentSummary;
  exposure: ExposureSummary;
  aligned_before_jpeg?: string | null;
  aligned_after_jpeg?: string | null;
}

export interface VisionImage {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EAI_AGAIN',
]);

const isTransient = (err: unknown): boolean => {
  if (!axios.isAxiosError(err)) return false;
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  const status = err.response?.status;
  return status !== undefined && status >= 500;
};

/**
 * Turn any thrown error into a `VisionServiceError`.
 *
 * A 4xx carries the sidecar's `detail` token and means the photo is the
 * problem; anything else means the service is, and the two must not be
 * confused — telling someone their photo is unusable because a container is
 * down would send them off to retake a perfectly good picture.
 */
const toVisionError = (err: unknown, operation: string): VisionServiceError => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status !== undefined && status >= 400 && status < 500) {
      const data = err.response?.data as { detail?: unknown } | undefined;
      const detail = data?.detail;
      return new VisionServiceError(
        typeof detail === 'string' && detail ? detail : 'rejected',
        true,
        `Vision service rejected ${operation}: ${String(detail ?? status)}`
      );
    }
    return new VisionServiceError(
      err.code || 'vision_unavailable',
      false,
      `Vision service failed ${operation}: ${err.code || err.message}`
    );
  }
  return new VisionServiceError(
    'vision_unavailable',
    false,
    `Vision service failed ${operation}: ${err instanceof Error ? err.message : String(err)}`
  );
};

async function postWithRetry<T>(
  path: string,
  body: FormData,
  operation: string,
  retries = 2
): Promise<AxiosResponse<T>> {
  if (!isVisionConfigured()) {
    throw new VisionServiceError(
      'vision_not_configured',
      false,
      'VISION_MICROSERVICE_URL is not set'
    );
  }
  const url = `${baseUrl()}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await visionAxios.post<T>(url, body);
    } catch (err: unknown) {
      if (attempt < retries && isTransient(err)) {
        const delayMs = (attempt + 1) * 1000;
        log(
          'warn',
          `[visionService] Transient error calling ${url} (${err instanceof Error ? err.message : String(err)}). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw toVisionError(err, operation);
    }
  }
  /* c8 ignore next */
  throw new VisionServiceError(
    'vision_unavailable',
    false,
    'retries exhausted'
  );
}

const part = (image: VisionImage): Blob =>
  new Blob([new Uint8Array(image.bytes)], { type: image.contentType });

/** Measure one photo. */
export const analyzePhoto = async (
  image: VisionImage
): Promise<VisionAnalysis> => {
  const form = new FormData();
  form.append('image', part(image), image.filename);
  const response = await postWithRetry<VisionAnalysis>(
    '/analyze',
    form,
    'analyze'
  );
  return response.data;
};

/**
 * Measure a pair and fit one onto the other.
 *
 * `includeAligned` also returns both frames as base64 JPEG, which is by far
 * the largest thing in the response — ask for it only when something is about
 * to draw them.
 */
export const comparePhotos = async (
  before: VisionImage,
  after: VisionImage,
  includeAligned = false
): Promise<VisionComparison> => {
  const form = new FormData();
  form.append('before', part(before), before.filename);
  form.append('after', part(after), after.filename);
  const response = await postWithRetry<VisionComparison>(
    `/compare?include_aligned=${includeAligned ? 'true' : 'false'}`,
    form,
    'compare'
  );
  return response.data;
};

/** Whether the sidecar is up, and which engine it is running. */
export const visionHealth = async (): Promise<{
  configured: boolean;
  ok: boolean;
  engine: string | null;
}> => {
  if (!isVisionConfigured()) {
    return { configured: false, ok: false, engine: null };
  }
  try {
    const response = await visionAxios.get<{ status: string; engine: string }>(
      `${baseUrl()}/health`,
      { timeout: 10000 }
    );
    return {
      configured: true,
      ok: response.data?.status === 'ok',
      engine: response.data?.engine ?? null,
    };
  } catch (err) {
    log(
      'warn',
      `[visionService] Health check failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { configured: true, ok: false, engine: null };
  }
};
