import axios from 'axios';
import NodeCache from 'node-cache';
import {
  OPENFDA_MAX_PRODUCTS,
  OPENFDA_RXCUI_PATTERN,
  parseOpenFdaNdcResponse,
  type OpenFdaLookupResponse,
  type OpenFdaProduct,
} from '@workspace/shared';
import { log } from '../../config/logging.js';

/**
 * openFDA's NDC directory — the labeler, form and route behind a medication the user has saved.
 *
 * WHY THIS ONE IS A PROXY, AND WHY THE ARGUMENT IS DIFFERENT FROM RXTERMS'
 *
 * `RxTermsService` is proxied because its query is a medication name typed a keystroke at a time,
 * and that must not leave the user's own infrastructure. Nothing like that is true here: the
 * query is an RxCUI, a public numeric code for a drug product. It names no person and no
 * prescription, and a browser could send it without telling the FDA anything.
 *
 * It is still proxied, for two reasons that are about the *user's IP address* rather than the
 * query. First, a request from the browser is a request from the user's home connection to a US
 * federal API, which is a fact about them even when its contents are not. Second, openFDA's rate
 * limit is per-IP — 240 requests a minute, 1,000 a day, anonymously — and a self-hosted server
 * with a warm cache stays comfortably inside that on behalf of a household, where a dozen
 * browsers each spending their own quota would not.
 *
 * That limit is also why the trigger is what it is. This never runs while someone is typing: it
 * is keyed on a stored `rxnorm_rxcui`, which only exists once a medication has been picked from
 * the catalog and saved, so the request volume is one per medication added rather than one per
 * keystroke. Nothing in this file needs to defend against a search box.
 *
 * The parsing half and the display rules live in `shared/src/medications/openfda.ts`, because
 * web and mobile both render these products.
 */

const OPENFDA_NDC_URL = 'https://api.fda.gov/drug/ndc.json';

/**
 * The NDC directory is republished on a slow cycle and describes registrations, not stock — a
 * labeler does not change between two app opens. A day matches `RxTermsService` and keeps the
 * two caches reasoning alike; the point of both is to be warm within a session, not to be a
 * store of record.
 *
 * `maxKeys` bounds what a long-lived process can accumulate. It is smaller than the RxTerms
 * cache because it is keyed by RxCUI rather than by search term, and there are far fewer drugs a
 * household saves than prefixes it types.
 *
 * `useClones: false` hands back the stored array by reference. Safe only because nothing mutates
 * a result — the route serialises it straight to JSON — and a future caller that starts editing
 * these products must copy first.
 */
const MAX_CACHED_RXCUIS = 2000;
const responseCache = new NodeCache({
  stdTTL: 60 * 60 * 24,
  maxKeys: MAX_CACHED_RXCUIS,
  useClones: false,
});

/** What one answered RxCUI is worth keeping: the products, and how many the FDA actually holds. */
interface CachedLookup {
  products: OpenFdaProduct[];
  totalMatches: number;
}

/**
 * Cache a result without letting the cache decide whether the request succeeded.
 *
 * `maxKeys` makes NodeCache **throw** ECACHEFULL on insert rather than evicting. Inside the
 * request's own try block that throw would be caught as a failed lookup, and a perfectly good
 * response would be reported as an unreachable FDA — for every lookup, from the moment the cache
 * filled. So the write is isolated and best-effort: a full cache is emptied and retried once,
 * and if that fails the result is still returned. Same reasoning, and the same shape, as
 * `RxTermsService.remember`.
 */
function remember(rxcui: string, value: CachedLookup): void {
  try {
    responseCache.set(rxcui, value);
  } catch {
    try {
      responseCache.flushAll();
      responseCache.set(rxcui, value);
    } catch {
      // Nothing left to try, and nothing that should reach the caller.
    }
  }
}

/**
 * Short by design. The panel this feeds is provenance layered over a medication record that has
 * already rendered, so a slow FDA must cost the user a detail line, never the page.
 */
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Name the failure without naming the drug.
 *
 * An axios error carries `config.params`, which here is the RxCUI. That is far less sensitive
 * than the medication name `RxTermsService` guards, but it is still a pointer to what one
 * identifiable server's user takes, and there is no reason for it to be in a log file. The
 * failure mode is worth naming; the code is not.
 */
function logUpstreamFailure(error: unknown): void {
  const reason =
    error instanceof Error && error.name === 'AggregateError'
      ? 'network'
      : ((error as { code?: string }).code ?? 'unknown');
  log(
    'warn',
    `[OpenFdaService] NDC lookup failed before a response was parsed (${reason})`
  );
}

/**
 * Look up the labelled products for one RxCUI.
 *
 * Never throws and never returns an error the user has to dismiss. A malformed code, an
 * unreachable FDA and a drug the directory does not list are three different answers, and the
 * caller renders each differently — but all three are ordinary outcomes of asking, not faults.
 *
 * **404 is not a failure.** openFDA answers "no matches" with a 404 body rather than an empty
 * result set, so treating a non-200 as unavailable would report every unlisted drug as an
 * outage. It is cached like any other answer: a drug the directory does not carry today will not
 * start carrying it before the TTL expires, and re-asking on every page view would spend the
 * per-IP quota on a question already answered.
 */
export async function lookupNdcByRxcui(
  rxcui: string
): Promise<OpenFdaLookupResponse> {
  // Validated before a request is built rather than after: the RxCUI is interpolated into a
  // Lucene query below, and digits are the only thing that belongs there.
  if (!OPENFDA_RXCUI_PATTERN.test(rxcui)) {
    return { products: [], totalMatches: 0, unavailableReason: 'not_found' };
  }

  const cached = responseCache.get<CachedLookup>(rxcui);
  if (cached !== undefined) {
    return {
      products: cached.products,
      totalMatches: cached.totalMatches,
      unavailableReason: cached.products.length > 0 ? null : 'not_found',
    };
  }

  try {
    const response = await axios.get(OPENFDA_NDC_URL, {
      params: {
        search: `openfda.rxcui:"${rxcui}"`,
        limit: OPENFDA_MAX_PRODUCTS,
      },
      timeout: REQUEST_TIMEOUT_MS,
      // A non-2xx is classified below rather than thrown through, because 404 is an answer.
      validateStatus: () => true,
    });

    if (response.status === 404) {
      remember(rxcui, { products: [], totalMatches: 0 });
      return { products: [], totalMatches: 0, unavailableReason: 'not_found' };
    }

    if (response.status !== 200) {
      log(
        'warn',
        `[OpenFdaService] NDC lookup unavailable: upstream returned ${response.status}`
      );
      return {
        products: [],
        totalMatches: 0,
        unavailableReason: 'lookup_failed',
      };
    }

    const parsed = parseOpenFdaNdcResponse(response.data);
    remember(rxcui, parsed);
    return {
      products: parsed.products,
      totalMatches: parsed.totalMatches,
      unavailableReason: parsed.products.length > 0 ? null : 'not_found',
    };
  } catch (error) {
    logUpstreamFailure(error);
    // Deliberately not cached. An upstream blip must not freeze a drug as unlisted for a day.
    return {
      products: [],
      totalMatches: 0,
      unavailableReason: 'lookup_failed',
    };
  }
}

/** Test seam. The cache is process-wide, so a suite that does not clear it leaks between cases. */
export function __clearOpenFdaCacheForTests(): void {
  responseCache.flushAll();
}

export default { lookupNdcByRxcui };
