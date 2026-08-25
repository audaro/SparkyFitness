import axios from 'axios';
import NodeCache from 'node-cache';
import {
  parseRxTermsResponse,
  RXTERMS_MIN_TERM_LENGTH,
  type MedicationCatalogSearchResponse,
  type RxTermsProduct,
} from '@workspace/shared';
import { log } from '../../config/logging.js';

/**
 * RxTerms (NLM Clinical Table Search Service) — the network tier of the medication search.
 *
 * WHY THIS IS A SERVER-SIDE PROXY AND NOT A BROWSER FETCH
 *
 * RxTerms sends `Access-Control-Allow-Origin: *`, so the client could call it directly and this
 * file could not exist. It should not. The query string here is a medication name, typed a
 * keystroke at a time by someone recording their own prescriptions — the most sensitive category
 * of data in this app. Calling NLM from the browser would send that, with the user's IP, to a
 * third party on every keypress. Proxied, NIH sees a request from the server the user already
 * runs and nothing about who asked.
 *
 * That premise only holds if this file keeps its side of it, which is the reason for the logging
 * rules below.
 *
 * The parsing half is `shared/src/medications/rxterms.ts` — web and mobile both render these
 * results, so the shapes and the strength parser belong where all three packages can read them.
 */

const RXTERMS_SEARCH_URL =
  'https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search';

/**
 * The drug catalog changes weekly at most, so a long TTL costs nothing in freshness and removes
 * any load question — NLM publishes no rate limit, and the polite reading of "no published
 * limit" is not to lean on it. `maxKeys` bounds the memory a long-lived process can accumulate —
 * see `rememberProducts` for what NodeCache actually does when that bound is hit.
 *
 * In-process, not a table: the blueprint's optional `medication_catalog_cache` migration is a
 * phase 6 item, and a cache that is warm within a session is all this needs to be.
 *
 * `useClones: false` returns the stored array by reference rather than deep-cloning it on every
 * hit. Safe only because nothing mutates a result — the route serialises it straight to JSON —
 * and a caller that starts editing these products must take a copy first.
 */
const MAX_CACHED_TERMS = 5000;
const responseCache = new NodeCache({
  stdTTL: 60 * 60 * 24,
  maxKeys: MAX_CACHED_TERMS,
  useClones: false,
});

/**
 * Cache a result without letting the cache decide whether the request succeeded.
 *
 * `maxKeys` makes NodeCache **throw** ECACHEFULL on insert — it does not evict. Left inside the
 * request's own try block, that throw would be caught as a failed lookup and a perfectly good
 * response would be reported to the user as an unreachable upstream, for every search, from the
 * moment the cache filled. So the write is isolated here and is best-effort by design: a full
 * cache is emptied and the write retried once, and if even that fails the result is still
 * returned. Caching is an optimisation; answering is the job.
 */
function rememberProducts(cacheKey: string, products: RxTermsProduct[]): void {
  try {
    responseCache.set(cacheKey, products);
  } catch {
    try {
      responseCache.flushAll();
      responseCache.set(cacheKey, products);
    } catch {
      // Nothing left to try, and nothing that should reach the caller.
    }
  }
}

/**
 * Short by design. Tier 3 is an enhancement layered over two local tiers that have already
 * rendered, so a slow NLM must cost the user a suggestion, never a usable search box.
 */
const REQUEST_TIMEOUT_MS = 3000;

const DEFAULT_LIMIT = 8;

/**
 * Ask for more rows than are wanted, because `parseRxTermsResponse` drops products the curated
 * catalog already covers. Without headroom, a search that matched two suppressed incretins would
 * return a short list purely as a side effect of the suppression.
 */
const SUPPRESSION_HEADROOM = 4;

/**
 * The reason union and the response shape live in `shared` — the clients switch on them, so a
 * second copy here would be the one that drifts. This service never returns `lookup_disabled`;
 * that is the caller's gate, decided before anything reaches this file.
 */
const EMPTY: MedicationCatalogSearchResponse = {
  products: [],
  unavailableReason: null,
};

/**
 * Search RxTerms for prescribable US products matching `term`.
 *
 * Never throws and never rejects. Every failure — timeout, 5xx, an envelope NLM has changed out
 * from under us — resolves to an empty result with a reason, because adding a medication must not
 * depend on the NIH being up.
 */
export async function searchRxTerms(
  term: string,
  limit: number = DEFAULT_LIMIT
): Promise<MedicationCatalogSearchResponse> {
  const query = term.trim();
  if (query.length < RXTERMS_MIN_TERM_LENGTH) {
    return { products: [], unavailableReason: 'term_too_short' };
  }
  if (limit <= 0) return EMPTY;

  const cacheKey = `${query.toLowerCase()}::${limit}`;
  const cached = responseCache.get<RxTermsProduct[]>(cacheKey);
  // `undefined` is a miss; a cached empty array is a real answer and is returned as one, so a
  // drug NLM does not carry is not re-fetched on every keystroke of every session.
  if (cached !== undefined) {
    return { products: cached, unavailableReason: null };
  }

  try {
    const response = await axios.get(RXTERMS_SEARCH_URL, {
      params: {
        terms: query,
        ef: 'STRENGTHS_AND_FORMS,RXCUIS',
        maxList: limit + SUPPRESSION_HEADROOM,
      },
      timeout: REQUEST_TIMEOUT_MS,
      // A non-2xx is handled below as an unavailable upstream rather than thrown through.
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      log(
        'warn',
        `[RxTermsService] Lookup unavailable: upstream returned ${response.status}`
      );
      return { products: [], unavailableReason: 'upstream_unavailable' };
    }

    const products = parseRxTermsResponse(response.data).slice(0, limit);
    rememberProducts(cacheKey, products);
    return { products, unavailableReason: null };
  } catch (error) {
    // DELIBERATELY NOT LOGGING THE ERROR OBJECT.
    //
    // An axios error carries `config.url` and `config.params`, and the params are the medication
    // name the user typed. Logging the error — the reflex, and what every other integration in
    // this directory does — would write that name into the server log and undo the entire reason
    // this proxy exists. The failure mode is worth naming; the query is not.
    const reason =
      error instanceof Error && error.name === 'AggregateError'
        ? 'network'
        : ((error as { code?: string }).code ?? 'unknown');
    log(
      'warn',
      `[RxTermsService] Lookup failed before a response was parsed (${reason})`
    );
    return { products: [], unavailableReason: 'upstream_unavailable' };
  }
}

/** Drop everything cached. Exported for tests; nothing in the running server calls it. */
export function clearRxTermsCache(): void {
  responseCache.flushAll();
}
