import { type OpenFdaLookupResponse } from '@workspace/shared';
import preferenceRepository from '../models/preferenceRepository.js';
import medicationRepository from '../models/medicationRepository.js';
import { lookupNdcByRxcui } from '../integrations/openfda/OpenFdaService.js';

/**
 * Label provenance for a saved medication, behind the same opt-in as the catalog search.
 *
 * WHY THIS REUSES `medication_catalog_lookup_enabled` RATHER THAN ASKING AGAIN
 *
 * This was the open question phase 6 could not be started without, and the answer turns on what
 * the existing preference actually asked. Its copy says: *"What this sends: the name you are
 * typing, from this server to the US National Library of Medicine."* A user who said yes to that
 * agreed to one thing — that this app may consult a public US drug database over the network to
 * fill in facts about a drug.
 *
 * This lookup is the same thing, and sends strictly less. RxTerms receives a **medication name**,
 * mid-typing, before the user has decided anything. openFDA receives an **RxCUI**: a public
 * numeric identifier the user already committed to by saving the medication, carrying no name and
 * nothing about them. Someone who accepted the larger disclosure has, by any reading, accepted
 * the smaller one.
 *
 * A second toggle would make consent worse rather than better. It would put two near-identical
 * questions on the settings page — one naming NLM, one naming the FDA — and create a state where
 * a user believes drug lookups are on and silently gets a degraded record. Consent is served by
 * one clear question, not by more of them.
 *
 * The honest cost of that decision is the copy: `settings.medications.catalogLookupPrivacy` named
 * NLM and only NLM, so reusing the preference without rewriting it would have kept a promise this
 * feature breaks. The copy now names both recipients and says which one gets what. **If a future
 * lookup sends something the copy does not describe, the copy changes with it or the lookup gets
 * its own opt-in** — that is the rule this decision rests on, not "one toggle covers everything".
 *
 * WHOSE OPT-IN GOVERNS
 *
 * The record owner's, for exactly the reason set out in `medicationCatalogService`: a caregiver
 * acting on a dependent's behalf is looking at the dependent's health data, and whether it may be
 * sent to a third party is the dependent's decision to have made. `user_preferences` is readable
 * by a delegate holding `can_manage_medications` (its SELECT policy is `has_profile_read_access`),
 * so this really does read the owner's answer rather than falling through to a default.
 */

/**
 * Look up who labels the drug on a medication record.
 *
 * The medication is read first, scoped to `ownerUserId` under RLS: a row that is not the owner's
 * yields `no_rxcui` and no request is made. That ordering is deliberate — the gate below is about
 * consent and this is about access, and access is settled first, so a caller cannot learn from a
 * response whether some other user's medication has an RxCUI.
 *
 * A medication with no stored `rxnorm_rxcui` is `no_rxcui`, not a failure. Most rows have none —
 * anything typed by hand, or picked from the bundled catalog, or added before tier 3 existed. It
 * is the ordinary case, and the client renders it as an absence of the panel rather than as an
 * error.
 */
export async function lookupMedicationLabel(
  ownerUserId: string,
  medicationId: string
): Promise<OpenFdaLookupResponse> {
  const medication = await medicationRepository.getMedicationById(
    ownerUserId,
    medicationId
  );

  const rxcui =
    typeof medication?.rxnorm_rxcui === 'string'
      ? medication.rxnorm_rxcui
      : null;
  if (rxcui === null || rxcui.trim().length === 0) {
    return { products: [], totalMatches: 0, unavailableReason: 'no_rxcui' };
  }

  const preferences =
    await preferenceRepository.getUserPreferences(ownerUserId);

  // Explicitly `!== true`, not `=== false` — the same reading as the catalog gate. A row that
  // predates the migration, or no row at all, is not an opt-in, and the safe answer to "no
  // answer recorded" for a question about a third-party request is no.
  if (preferences?.medication_catalog_lookup_enabled !== true) {
    return {
      products: [],
      totalMatches: 0,
      unavailableReason: 'lookup_disabled',
    };
  }

  return lookupNdcByRxcui(rxcui.trim());
}

export default { lookupMedicationLabel };
