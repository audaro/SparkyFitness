import { useQuery } from '@tanstack/react-query';
import type { OpenFdaLookupResponse } from '@workspace/shared';
import * as medicationService from '@/api/Medications/medicationService';
import { usePreferences } from '@/contexts/PreferencesContext';

/**
 * Label provenance for one saved medication — who makes it, in what form, by what route.
 *
 * This is the read half of phase 6 and it is deliberately unlike the catalog search next door.
 * That one fires while someone types and has to defend against every keystroke; this one is
 * keyed on a medication the user already saved, so there is at most one request per detail panel
 * opened and no debounce to speak of.
 *
 * It rides the **same** `medicationCatalogLookupEnabled` preference, because what it sends is
 * strictly less than what that preference already covers: an RxCUI, a public numeric drug code,
 * rather than a medication name being typed. The settings copy names both recipients — see
 * `services/medicationLabelService.ts` on the server for the argument in full.
 */

/**
 * The NDC directory is republished on a slow cycle and describes registrations, not stock. An
 * hour is plenty to make reopening the same medication free, and the server holds a day's cache
 * behind this anyway.
 */
const LABEL_STALE_TIME_MS = 60 * 60 * 1000;

export interface MedicationLabelState {
  /** The response, or null while there is nothing to show. */
  data: OpenFdaLookupResponse | null;
  isFetching: boolean;
}

export function useMedicationLabel(
  medicationId: string | null | undefined,
  options?: {
    /**
     * The medication's stored RxCUI. Absent means there is nothing to look up, and the panel is
     * simply not rendered — most rows have no RxCUI (anything typed by hand, or picked from the
     * bundled catalog), so this is the ordinary case rather than a failure.
     *
     * Checked here as well as on the server so that a medication with no RxCUI costs no request
     * at all, rather than a round trip that comes back saying `no_rxcui`.
     */
    rxcui?: string | null;
  }
): MedicationLabelState {
  const { rxcui } = options ?? {};
  const { medicationCatalogLookupEnabled } = usePreferences();

  // The preference is checked here as well as on the server for the reason
  // `useMedicationCatalogSearch` gives: the server gate is what makes the opt-in binding, but not
  // asking at all is the difference between "nothing left this machine" and "something left this
  // machine and was refused".
  const enabled = Boolean(
    medicationId && rxcui && rxcui.trim() && medicationCatalogLookupEnabled
  );

  const { data, isFetching } = useQuery({
    queryKey: ['medication-label', medicationId ?? null],
    queryFn: () => medicationService.getMedicationLabel(medicationId as string),
    enabled,
    // One attempt. This is provenance under a record that has already rendered; a retry buys a
    // line of small print at the cost of a second request against a per-IP daily quota.
    retry: false,
    staleTime: LABEL_STALE_TIME_MS,
    // Deliberately no `meta.errorMessage`: a failed background lookup must stay invisible, the
    // same as the catalog search. The API client suppresses its own toast for the same reason.
  });

  return {
    data: enabled ? (data ?? null) : null,
    isFetching: enabled && isFetching,
  };
}
