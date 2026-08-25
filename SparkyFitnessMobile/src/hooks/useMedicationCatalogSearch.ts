import { useQuery } from '@tanstack/react-query';
import { RXTERMS_MIN_TERM_LENGTH, type RxTermsProduct } from '@workspace/shared';
import { searchMedicationCatalog } from '../services/api/medicationsApi';
import { medicationCatalogSearchQueryKey } from './queryKeys';
import { useDebounce } from './useDebounce';
import { usePreferences } from './usePreferences';

/**
 * Tier 3 of the medication name search: the US drug catalog, over the network, opt-in.
 *
 * Everything here exists to keep a keystroke from becoming a request. Tiers 1 and 2 are in-memory
 * and render from the first character; this one waits for the typing to stop, for the term to be
 * long enough to be a drug name, and for the user to have said yes.
 *
 * The web hook (`SparkyFitnessFrontend/src/hooks/useMedicationCatalogSearch.ts`) is its twin, and
 * the rules below are deliberately identical on both platforms — a user who opted in on one and
 * sees different suggestions on the other has no way to tell which is right.
 */

/**
 * Long enough that a typist at a normal speed makes one request per word rather than one per
 * letter, short enough that the rows arrive while they are still looking at the list.
 */
export const MEDICATION_CATALOG_DEBOUNCE_MS = 250;

/** A drug catalog changes on the order of weeks; the same names get retyped within a session. */
const CATALOG_STALE_TIME_MS = 1000 * 60 * 60;

export interface MedicationCatalogSearchState {
  /** Products to offer, already suppressed against the curated catalog by the server. */
  products: RxTermsProduct[];
  /** True while a lookup is in flight. There is no error state — tier 3 never reports one. */
  isFetching: boolean;
}

const NO_PRODUCTS: RxTermsProduct[] = [];

export function useMedicationCatalogSearch(
  term: string,
  options?: {
    /** Rows to ask for. */
    limit?: number;
    /**
     * Whether anyone is looking. False suppresses the lookup entirely.
     *
     * The form passes whether its suggestion list is open, and the reason is the edit case: the
     * screen mounts with the medication's name already in the field, and `useDebounce` seeds
     * itself from whatever it is first given — so without this, opening an existing row to fix a
     * typo in its notes would send that drug's name to NLM, with nothing typed and no suggestion
     * list even on screen.
     */
    active?: boolean;
  },
): MedicationCatalogSearchState {
  const { limit, active = true } = options ?? {};
  // The lookup is off by default, so a preferences read that has not landed yet leaves it off.
  const { preferences } = usePreferences();
  const optedIn = preferences?.medication_catalog_lookup_enabled === true;

  const trimmed = term.trim();
  const debounced = useDebounce(trimmed, MEDICATION_CATALOG_DEBOUNCE_MS);

  // The preference is checked here, not just on the server. The server gate is what makes the
  // opt-in binding — a client can always be wrong — but not asking at all is the difference
  // between "no medication name left this device" and "a medication name left this device and
  // was refused", and the first is the promise this feature makes.
  const enabled =
    active && optedIn && debounced.length >= RXTERMS_MIN_TERM_LENGTH;

  const { data, isFetching } = useQuery({
    queryKey: medicationCatalogSearchQueryKey(debounced, limit),
    queryFn: () => searchMedicationCatalog(debounced, limit),
    enabled,
    // One attempt, overriding the client's default. A retry would put a second request on the
    // wire for a term the user has very likely already typed past, and the cost of a miss is a
    // suggestion that did not appear — not an error worth chasing.
    retry: false,
    staleTime: CATALOG_STALE_TIME_MS,
  });

  // While the user keeps typing, `debounced` still holds the previous term, so the rows on screen
  // belong to a *prefix* of what is in the field — stale by up to a debounce, but never wrong:
  // every product shown still matches what has been typed so far. The moment that stops being
  // true — they cleared the field, backspaced, or started a different drug — the rows are dropped
  // rather than left sitting under a name they no longer match.
  const stillDescribesInput = trimmed.startsWith(debounced);

  return {
    products:
      enabled && stillDescribesInput
        ? (data?.products ?? NO_PRODUCTS)
        : NO_PRODUCTS,
    isFetching: enabled && isFetching,
  };
}
