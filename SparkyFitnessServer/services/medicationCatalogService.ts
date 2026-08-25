import { type MedicationCatalogSearchResponse } from '@workspace/shared';
import preferenceRepository from '../models/preferenceRepository.js';
import { searchRxTerms } from '../integrations/rxterms/RxTermsService.js';

/**
 * Tier 3 of the medication search, behind its opt-in.
 *
 * This exists as its own service rather than as a few lines in the route because the gate is the
 * feature. The lookup is a medication name leaving the user's server for a third party, and the
 * only thing standing between the two is the check below — so it belongs somewhere it can be
 * read, tested and reasoned about on its own, not inline among request plumbing.
 */

/**
 * Whose opt-in governs, and why it is the record's owner rather than the caller.
 *
 * The medications routes support caregivers acting on a dependent's behalf, so these two can
 * differ. The name being typed is going to become a row in the *owner's* medication list — it is
 * the owner's health data, and whether it may be sent to NLM is the owner's decision to have
 * made, not one a delegate can make for them by having their own toggle on.
 *
 * `req.userId` is the active user (the owner in an on-behalf-of request), which is what the route
 * passes here. A delegate acting for someone who has not opted in gets tiers 1-2, exactly as that
 * person would themselves.
 *
 * That this can be read at all is worth stating, because the neighbouring tables behave
 * differently. `user_preferences` splits its policies: writes require
 * `authenticated_user_id() = user_id`, but SELECT goes through `has_profile_read_access`, which a
 * delegate holding any meaningful permission — `can_manage_medications` among them — satisfies. So
 * a caregiver on this route really does read the owner's answer rather than falling through to a
 * default. Contrast `coach_profiles`, whose read policy matches the authenticated caller and whose
 * routes are therefore owner-only; had this preference lived there, a delegate would silently see
 * "not opted in" for someone who had.
 */
export async function searchMedicationCatalog(
  ownerUserId: string,
  term: string,
  limit?: number
): Promise<MedicationCatalogSearchResponse> {
  const preferences =
    await preferenceRepository.getUserPreferences(ownerUserId);

  // Explicitly `!== true`, not `=== false`. A user whose preferences row predates the migration,
  // or who has no row at all, has not opted in — and the safe reading of "no answer recorded" for
  // a question about sending health data to a third party is no.
  if (preferences?.medication_catalog_lookup_enabled !== true) {
    return { products: [], unavailableReason: 'lookup_disabled' };
  }

  return searchRxTerms(term, limit);
}

export default { searchMedicationCatalog };
