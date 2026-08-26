import axios from 'axios';
import NodeCache from 'node-cache';
import {
  parseRxNavSpellingSuggestions,
  parseRxTermsResponseWithCounts,
  RXNAV_MAX_SPELLING_SUGGESTIONS,
  RXNAV_SPELLING_MIN_TERM_LENGTH,
  RXTERMS_MIN_TERM_LENGTH,
  searchCatalog,
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
 * RxNav's spelling suggestions, the typo fallback. Same host family as RxTerms, same privacy
 * argument, same rule about never logging the term — see `shared/src/medications/rxnav.ts` for
 * why this endpoint and not `approximateTerm`.
 */
const RXNAV_SPELLING_URL =
  'https://rxnav.nlm.nih.gov/REST/spellingsuggestions.json';

/**
 * The drug catalog changes weekly at most, so a long TTL costs nothing in freshness and removes
 * any load question — NLM publishes no rate limit, and the polite reading of "no published
 * limit" is not to lean on it. `maxKeys` bounds the memory a long-lived process can accumulate —
 * see `remember` for what NodeCache actually does when that bound is hit.
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
 * What one answered term is worth caching: the rows, and the spellings they were found under.
 *
 * `correctedTerms` is cached alongside the products rather than recomputed, because the whole
 * fallback chain — an empty RxTerms search, a spelling lookup, one search per suggestion — is
 * three to four upstream requests, and it should run once per typo rather than once per typist.
 */
interface CachedSearch {
  products: RxTermsProduct[];
  correctedTerms: string[];
}

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
function remember(cacheKey: string, value: CachedSearch): void {
  try {
    responseCache.set(cacheKey, value);
  } catch {
    try {
      responseCache.flushAll();
      responseCache.set(cacheKey, value);
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
 * Ask for more rows than are wanted, because the parser drops products the curated
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
  correctedTerms: [],
};

/**
 * Name the failure without naming the query.
 *
 * DELIBERATELY NOT LOGGING THE ERROR OBJECT. An axios error carries `config.url` and
 * `config.params`, and the params are the medication name the user typed. Logging the error —
 * the reflex, and what every other integration in this directory does — would write that name
 * into the server log and undo the entire reason this proxy exists. The failure mode is worth
 * naming; the query is not.
 */
function logUpstreamFailure(label: string, error: unknown): void {
  const reason =
    error instanceof Error && error.name === 'AggregateError'
      ? 'network'
      : ((error as { code?: string }).code ?? 'unknown');
  log(
    'warn',
    `[RxTermsService] ${label} failed before a response was parsed (${reason})`
  );
}

/** A lookup that either answered or did not. `ok: false` is never cached. */
type Attempt<T> = { ok: true; value: T } | { ok: false };

const FAILED: Attempt<never> = { ok: false };

/**
 * One RxTerms search, with no spelling fallback of its own.
 *
 * Split out from `searchRxTerms` because the fallback re-enters this and must not recurse: a
 * suggestion that itself returns nothing is a dead end, not a term to go on spell-checking.
 */
async function searchRxTermsDirect(
  query: string,
  limit: number
): Promise<Attempt<{ products: RxTermsProduct[]; matchedNameCount: number }>> {
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
      return FAILED;
    }

    const parsed = parseRxTermsResponseWithCounts(response.data);
    return {
      ok: true,
      value: {
        products: parsed.products.slice(0, limit),
        matchedNameCount: parsed.matchedNameCount,
      },
    };
  } catch (error) {
    logUpstreamFailure('Lookup', error);
    return FAILED;
  }
}

/** Ask RxNav what the user probably meant. Best first; empty when it has no idea. */
async function suggestSpellings(query: string): Promise<Attempt<string[]>> {
  try {
    const response = await axios.get(RXNAV_SPELLING_URL, {
      params: { name: query },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      log(
        'warn',
        `[RxTermsService] Spelling suggestions unavailable: upstream returned ${response.status}`
      );
      return FAILED;
    }

    return {
      ok: true,
      value: parseRxNavSpellingSuggestions(response.data, query).slice(
        0,
        RXNAV_MAX_SPELLING_SUGGESTIONS
      ),
    };
  } catch (error) {
    logUpstreamFailure('Spelling suggestions', error);
    return FAILED;
  }
}

/**
 * Merge the per-suggestion result lists by taking one row from each in turn.
 *
 * Round-robin rather than concatenation, and this is the point of the whole fallback rather than
 * a tidying detail. RxNav answers `metfromin` with `["merbromin", "metformin"]`; merbromin's rows
 * come back first, and concatenated they would fill a five-row cap on their own — leaving a
 * diabetes-drug typo answered exclusively by a topical antiseptic, which is worse than the empty
 * list this feature replaced. Interleaved, every spelling that produced anything is visible in
 * the first rows, under its own real name, and the user recognises theirs.
 *
 * De-duplicated on `displayName`, since two suggestions can legitimately land on one product.
 */
function interleave(
  lists: RxTermsProduct[][],
  limit: number
): RxTermsProduct[] {
  const merged: RxTermsProduct[] = [];
  const seen = new Set<string>();
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);

  for (let index = 0; index < longest && merged.length < limit; index += 1) {
    for (const list of lists) {
      if (merged.length >= limit) break;
      const product = list[index];
      if (!product || seen.has(product.displayName)) continue;
      seen.add(product.displayName);
      merged.push(product);
    }
  }

  return merged;
}

/**
 * Search RxTerms for prescribable US products matching `term`, correcting an obvious misspelling
 * when the term as typed matches nothing at all.
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
    return {
      products: [],
      unavailableReason: 'term_too_short',
      correctedTerms: [],
    };
  }
  if (limit <= 0) return EMPTY;

  const cacheKey = `${query.toLowerCase()}::${limit}`;
  const cached = responseCache.get<CachedSearch>(cacheKey);
  // `undefined` is a miss; a cached empty result is a real answer and is returned as one, so a
  // drug NLM does not carry is not re-fetched on every keystroke of every session.
  if (cached !== undefined) {
    return { ...cached, unavailableReason: null };
  }

  const direct = await searchRxTermsDirect(query, limit);
  if (!direct.ok) {
    return {
      products: [],
      unavailableReason: 'upstream_unavailable',
      correctedTerms: [],
    };
  }

  // Three conditions, each ruling out a different way a spell-check would be wasted work.
  //
  // `matchedNameCount` and not `products.length`: a term whose every row was suppressed because
  // the curated catalog describes it better was spelled perfectly well, and spell-checking it
  // would spend two more upstream requests to answer a question the user got right.
  //
  // The length floor keeps a half-typed word from being "corrected" into a finished one.
  //
  // And a term tier 2 can already answer is not a typo to fix at all — it is this app's own
  // subject matter. RxTerms carries no peptide, so *every* retatrutide, BPC-157 and ipamorelin
  // search reaches this point with nothing, and without this line each of them would spend a
  // spelling lookup plus a search per suggestion to arrive back at the rows the bundled catalog
  // had rendered offline before the request was even sent. `searchCatalog` is the same call the
  // clients make for tier 2 and it is free, so "does tier 2 have anything to say" is exactly the
  // right question and it costs nothing to ask.
  const spellable =
    direct.value.matchedNameCount === 0 &&
    query.length >= RXNAV_SPELLING_MIN_TERM_LENGTH &&
    searchCatalog(query, 1).length === 0;

  if (!spellable) {
    const answer: CachedSearch = {
      products: direct.value.products,
      correctedTerms: [],
    };
    remember(cacheKey, answer);
    return { ...answer, unavailableReason: null };
  }

  const suggestions = await suggestSpellings(query);
  if (!suggestions.ok) {
    // The direct answer stands, but it is not cached: the spelling half of it never ran, and
    // freezing "nothing found" for a day over a transient RxNav blip would make a typo
    // permanently uncorrectable for this process.
    return { products: [], unavailableReason: null, correctedTerms: [] };
  }

  const perSuggestion: RxTermsProduct[][] = [];
  const correctedTerms: string[] = [];
  let anyFailed = false;

  for (const suggestion of suggestions.value) {
    const attempt = await searchRxTermsDirect(suggestion, limit);
    if (!attempt.ok) {
      anyFailed = true;
      continue;
    }
    if (attempt.value.products.length === 0) continue;
    // Only a spelling that produced rows is reported. "Did you mean merbromin?" above no
    // merbromin rows is a correction the user cannot act on or verify.
    correctedTerms.push(suggestion);
    perSuggestion.push(attempt.value.products);
  }

  const answer: CachedSearch = {
    products: interleave(perSuggestion, limit),
    correctedTerms,
  };
  // A partial chain is answered but not remembered, for the same reason as above.
  if (!anyFailed) remember(cacheKey, answer);
  return { ...answer, unavailableReason: null };
}

/** Drop everything cached. Exported for tests; nothing in the running server calls it. */
export function clearRxTermsCache(): void {
  responseCache.flushAll();
}
