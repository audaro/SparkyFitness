import { getActiveServerConfig, proxyHeadersToRecord } from '../storage';
import { addLog } from '../LogService';
import { getAuthHeaders, notifySessionExpired } from './authService';
import { ApiError } from './errors';
import { DEFAULT_API_TIMEOUT_MS, fetchWithTimeout } from '../../utils/concurrency';
import { normalizeUrl } from '../../utils/serverUrl';

export { normalizeUrl };

interface ApiFetchOptions {
  endpoint: string;
  serviceName: string;
  operation: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Statuses this caller treats as a normal answer rather than a failure. They
   * still throw — the caller keeps its `catch` — but they are not written to
   * the app log as ERROR. Without this, a documented empty state that the
   * server reports as 404 fills the user's log with "Failed to …" every time
   * the screen is opened, and buries the errors that do matter.
   */
  expectedStatuses?: number[];
}

export async function apiFetch<T>(options: ApiFetchOptions): Promise<T> {
  const {
    endpoint,
    serviceName,
    operation,
    method = 'GET',
    body,
    headers: customHeaders,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    expectedStatuses,
  } = options;

  const config = await getActiveServerConfig();
  if (!config) {
    throw new Error('Server configuration not found.');
  }

  const baseUrl = normalizeUrl(config.url);

  if (!__DEV__ && baseUrl.toLowerCase().startsWith('http://')) {
    throw new Error('HTTPS is required for server connections. Please update your server URL in Settings.');
  }

  try {
    const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
      method,
      // Defeat the native HTTP cache (iOS NSURLCache/CFNetwork, Android OkHttp).
      // Left cacheable, it stores GET responses and silently replays
      // If-None-Match/If-Modified-Since on the next request, so the server (or a
      // reverse proxy in front of it) answers 304 with an empty body — which
      // surfaces in the app as "Failed to Load" (#1353). The native bridge does
      // not forward a fetch cache policy; instead RN's whatwg-fetch polyfill
      // rewrites the GET URL with a `_=<timestamp>` cache-buster when this is
      // set, so every request misses the native cache. React Query owns all
      // caching here, so the HTTP layer should never revalidate. Only GET is
      // cacheable, and the polyfill appends the cache-buster regardless of
      // method, so we scope this to GET to avoid pinning `_` onto mutating URLs.
      ...(method === 'GET' ? { cache: 'no-store' as const } : {}),
      headers: {
        ...proxyHeadersToRecord(config.proxyHeaders),
        ...getAuthHeaders(config),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        // Identify this client to the server as understanding the new meal
        // serving model (issue #1023). Older mobile builds omit this header
        // and the server applies legacy "unit === 'serving' → multiplier =
        // quantity" math for backwards compatibility on diary-meal creates.
        'X-Meal-Model-Version': '2',
        ...customHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, timeoutMs);

    if (!response.ok) {
      if (response.status === 401 && config.authType === 'session') {
        notifySessionExpired(config.id);
      }
      const errorText = await response.text();
      if (!expectedStatuses?.includes(response.status)) {
        addLog(`[${serviceName}] Failed to ${operation}: ${response.status}`, 'ERROR', [errorText]);
      }
      throw new ApiError(`Server error: ${response.status} - ${errorText}`, response.status, errorText);
    }

    if (response.status === 204 || response.headers?.get('content-length') === '0') {
      return undefined as T;
    }

    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An ApiError has already been logged (or deliberately not) above; logging
    // it again here would double every failed request in the app log.
    if (!(error instanceof ApiError)) {
      addLog(`[${serviceName}] Failed to ${operation}: ${message}`, 'ERROR');
    }
    throw error;
  }
}
