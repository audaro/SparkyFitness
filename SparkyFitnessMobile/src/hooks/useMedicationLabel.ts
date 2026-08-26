import { useQuery } from '@tanstack/react-query';
import type { OpenFdaLookupResponse } from '@workspace/shared';
import { getMedicationLabel } from '../services/api/medicationsApi';
import { medicationLabelQueryKey } from './queryKeys';
import { usePreferences } from './usePreferences';

/**
 * Label provenance for one saved medication — who makes it, in what form, by what route.
 *
 * Deliberately unlike the catalog search next door. That one fires while someone types and has to
 * defend against every keystroke; this one is keyed on a medication the user already saved, so
 * there is at most one request per detail screen opened and no debounce to speak of.
 *
 * It rides the **same** `medication_catalog_lookup_enabled` preference, because what it sends is
 * strictly less than what that preference already covers: an RxCUI, a public numeric drug code,
 * rather than a medication name being typed. The settings copy names both recipients — see
 * `SparkyFitnessServer/services/medicationLabelService.ts` for the argument in full.
 *
 * The web hook (`SparkyFitnessFrontend/src/hooks/useMedicationLabel.ts`) is its twin; the rules
 * are identical on both platforms on purpose.
 */

/**
 * The NDC directory is republished on a slow cycle and describes registrations, not stock. An
 * hour makes reopening the same medication free, and the server holds a day's cache behind this.
 */
const LABEL_STALE_TIME_MS = 1000 * 60 * 60;

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
  },
): MedicationLabelState {
  const { rxcui } = options ?? {};
  // The lookup is off by default, so a preferences read that has not landed yet leaves it off.
  const { preferences } = usePreferences();
  const optedIn = preferences?.medication_catalog_lookup_enabled === true;

  // The preference is checked here, not just on the server, for the reason
  // `useMedicationCatalogSearch` gives: the server gate is what makes the opt-in binding, but not
  // asking at all is the difference between "nothing left this device" and "something left this
  // device and was refused".
  const enabled = Boolean(medicationId && rxcui && rxcui.trim() && optedIn);

  const { data, isFetching } = useQuery({
    queryKey: medicationLabelQueryKey(medicationId ?? ''),
    queryFn: () => getMedicationLabel(medicationId as string),
    enabled,
    // One attempt, overriding the client's default. This is provenance under a record that has
    // already rendered; a retry buys a line of small print at the cost of a second request
    // against a per-IP daily quota.
    retry: false,
    staleTime: LABEL_STALE_TIME_MS,
  });

  return {
    data: enabled ? (data ?? null) : null,
    isFetching: enabled && isFetching,
  };
}
