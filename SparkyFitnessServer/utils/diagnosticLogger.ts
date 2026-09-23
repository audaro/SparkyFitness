import fs from 'fs';
import path from 'path';
import { log } from '../config/logging.js';
import { fileURLToPath } from 'url';
import { isMockCaptureEnabled } from './mockDataContext.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIAGNOSTICS_DIR = path.join(__dirname, '..', 'mock_data');

// A thrown value is `unknown`; this keeps the log line honest without
// widening the catch parameter to `any`, which this package's lint bans.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Logs a raw JSON response from an external provider to a consolidated raw bundle in the mock_data directory.
 *
 * @param {string} provider - The name of the provider (e.g., 'polar', 'fitbit')
 * @param {string} dataType - The type of data being logged (e.g., 'sleep', 'exercises')
 * @param {unknown} data - The raw JSON data to log
 * @param {boolean} [saveMockData] - Whether this sync was asked to capture a
 *   mock bundle. The caller resolves this from the per-sync request option,
 *   which the routes only honour while the admin `mock_data_enabled` setting
 *   is on, so nothing is written to disk by default.
 */
function logRawResponse(
  provider: string,
  dataType: string,
  data: unknown,
  saveMockData?: boolean
) {
  // Most call sites omit the argument and rely on the sync's async context,
  // which the provider entry point set from the per-sync request option.
  if (!(saveMockData ?? isMockCaptureEnabled())) return;
  try {
    if (!fs.existsSync(DIAGNOSTICS_DIR)) {
      fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
    }
    const safeProvider = path
      .basename(String(provider))
      .replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(DIAGNOSTICS_DIR, `${safeProvider}_raw.json`);
    // Start with a fresh bundle every time to prevent stale/incorrectly formatted data
    let bundle = {
      provider: safeProvider,
      last_updated: new Date().toISOString(),
      responses: {} as Record<string, unknown>,
    };
    // If we want to capture multiple data types within a SINGLE sync session (e.g. activities + sleep),
    // we should still allow merging IF the file was updated very recently (e.g. within the last 1 minute).
    // Otherwise, start fresh.
    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        const now = new Date();
        const lastModified = new Date(stats.mtime);
        const diffInSeconds = (now.getTime() - lastModified.getTime()) / 1000;
        // If updated within the last 60 seconds, it's likely the same sync process
        if (diffInSeconds < 60) {
          const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          bundle = { ...bundle, ...existingData };
        }
      } catch (err) {
        console.error(
          `Failed to read or parse existing file at ${filePath}:`,
          errorMessage(err)
        );
      }
    }
    bundle.last_updated = new Date().toISOString();
    // Update the specific data type with the new raw response
    bundle.responses[dataType] = {
      timestamp: new Date().toISOString(),
      data: data,
    };
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
    log(
      'info',
      `[diagnosticLogger] Raw ${dataType} data for ${safeProvider} updated in ${filePath}`
    );
  } catch (error) {
    log(
      'error',
      `[diagnosticLogger] Failed to save raw ${dataType} data for ${provider}: ${errorMessage(error)}`
    );
  }
}

/**
 * Loads a consolidated raw bundle for a provider.
 *
 * @param {string} provider - The name of the provider
 * @returns {object|null} - The parsed bundle or null
 */
function loadRawBundle(provider: string) {
  const safeProvider = path
    .basename(String(provider))
    .replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(DIAGNOSTICS_DIR, `${safeProvider}_raw.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    log(
      'error',
      `[diagnosticLogger] Failed to load raw bundle for ${provider}: ${errorMessage(error)}`
    );
    return null;
  }
}

export { logRawResponse };
export { loadRawBundle };
export default {
  logRawResponse,
  loadRawBundle,
};
