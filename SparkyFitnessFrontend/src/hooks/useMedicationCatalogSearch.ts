import { useQuery } from '@tanstack/react-query';
import {
  RXTERMS_MIN_TERM_LENGTH,
  type RxTermsProduct,
} from '@workspace/shared';
import * as medicationService from '@/api/Medications/medicationService';
import { useDebounce } from '@/hooks/useDebounce';
import { usePreferences } from '@/contexts/PreferencesContext';

/**
 * Tier 3 of the medication name search: the US drug catalog, over the network, opt-in.
 *
 * Everything here exists to keep a keystroke from becoming a request. Tiers 1 and 2 are in-memory
 * and render from the first character; this one waits for the typing to stop, for the term to be
 * long enough to be a drug name, and for the user to have said yes.
 */

/**
 * Long enough that a typist at a normal speed makes one request per word rather than one per
 * letter, short enough that the rows arrive while they are still looking at the dropdown.
 */
export const MEDICATION_CATALOG_DEBOUNCE_MS = 250;

/**
 * A drug catalog changes on the order of weeks, and the same names get retyped across a session
 * (open the dialog, close it, open it again). Long staleness turns all of that into one request.
 */
const CATALOG_STALE_TIME_MS = 60 * 60 * 1000;

export interface MedicationCatalogSearchState {
  /** Products to offer, already suppressed against the curated catalog by the server. */
  products: RxTermsProduct[];
  /**
   * Spellings the products were found under, when the term as typed matched nothing. Empty in
   * the ordinary case. Non-empty means the list has to say so — see the shared response type.
   */
  correctedTerms: string[];
  /** True while a lookup is in flight. Nothing renders an error state — there isn't one. */
  isFetching: boolean;
}

const NO_PRODUCTS: RxTermsProduct[] = [];
const NO_CORRECTIONS: string[] = [];

export function useMedicationCatalogSearch(
  term: string,
  options?: {
    /** Rows to ask for. */
    limit?: number;
    /**
     * Whether anyone is looking. False suppresses the lookup entirely.
     *
     * The combobox passes its dropdown state, and the reason is the edit dialog: it mounts with
     * the medication's name already in the box, and `useDebounce` seeds itself from whatever it
     * is first given — so without this, opening an existing row to fix a typo in its notes would
     * send that drug's name to NLM, with the user having typed nothing and no suggestion list
     * even on screen.
     */
    active?: boolean;
  }
): MedicationCatalogSearchState {
  const { limit, active = true } = options ?? {};
  const { medicationCatalogLookupEnabled } = usePreferences();

  const trimmed = term.trim();
  const debounced = useDebounce(trimmed, MEDICATION_CATALOG_DEBOUNCE_MS);

  // The preference is checked here, not just on the server. The server gate is what makes the
  // opt-in binding — a client can always be wrong — but not asking at all is the difference
  // between "no medication name left this machine" and "a medication name left this machine and
  // was refused", and the first is the promise this feature makes.
  const enabled =
    active &&
    medicationCatalogLookupEnabled &&
    debounced.length >= RXTERMS_MIN_TERM_LENGTH;

  const { data, isFetching } = useQuery({
    // Lowercased: RxTerms is case-insensitive, so `Metformin` and `metformin` are one cache entry.
    queryKey: ['medication-catalog', debounced.toLowerCase(), limit ?? null],
    queryFn: () => medicationService.searchMedicationCatalog(debounced, limit),
    enabled,
    // One attempt. A retry would put a second request on the wire for a term the user has very
    // likely already typed past, and the client-side cost of a miss is a suggestion that did not
    // appear — not an error worth chasing.
    retry: false,
    staleTime: CATALOG_STALE_TIME_MS,
    // Deliberately no `meta.errorMessage`: that is what makes the global query-error handler raise
    // a toast, and a failed background lookup must stay invisible. The API client suppresses its
    // own toast for the same reason.
  });

  // While the user keeps typing, `debounced` still holds the previous term, so the rows on screen
  // belong to a *prefix* of what is in the box — stale by up to a debounce, but never wrong: every
  // product shown still matches what has been typed so far. The moment that stops being true —
  // they cleared the box, backspaced, or started a different drug — the rows are dropped rather
  // than left sitting under a name they no longer match.
  const stillDescribesInput = trimmed.startsWith(debounced);
  const usable = enabled && stillDescribesInput;

  return {
    products: usable ? (data?.products ?? NO_PRODUCTS) : NO_PRODUCTS,
    // Kept together with the products deliberately: a corrected spelling that outlived the rows
    // it explains would caption someone else's list, and rows that outlived their caption would
    // read as matches for what was typed.
    correctedTerms: usable
      ? (data?.correctedTerms ?? NO_CORRECTIONS)
      : NO_CORRECTIONS,
    isFetching: enabled && isFetching,
  };
}
