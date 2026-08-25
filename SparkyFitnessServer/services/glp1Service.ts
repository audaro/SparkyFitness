import {
  resolveGlp1Profile,
  simulateSerumCurve,
  serumLevelAt,
  suggestNextSite,
  INJECTION_SITES,
  SITE_REST_DAYS,
  type DoseEvent,
  type RecentSiteUse,
  type SerumPoint,
  type SerumCurveUnavailableReason,
  type SiteRotationResult,
} from '@workspace/shared';
import injectionRepository from '../models/injectionRepository.js';
import medicationRepository from '../models/medicationRepository.js';
import medicationDisplayPreferenceRepository from '../models/medicationDisplayPreferenceRepository.js';

interface InjectionRow {
  id: string;
  injected_at: string | Date;
  site: string | null;
  dose_mg: string | number | null;
}

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Parse a user-supplied PK field. Returns null for blank, non-numeric, zero and negative
 * values rather than coercing — `Number('') === 0` and `Number(null) === 0`, so a plain
 * `Number(x) || fallback` cannot tell "unset" from "invalid" from a real value.
 */
function positivePkValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Time-to-peak only shapes the rising edge of the curve; `absorptionRate` already clamps
 * unreachable values, and a wrong tMax cannot fabricate persistence the way a wrong half-life
 * can. So it keeps a documented default where half-life gets none.
 */
const DEFAULT_CUSTOM_T_MAX_DAYS = 1.5;

/**
 * Build the modeled serum-level curve for a GLP-1 medication from the user's injection history.
 * Returns the sampled curve plus the current modeled level. This is a PK *model* (Bateman
 * one-compartment), not a measured value.
 */
async function getSerumCurve(
  userId: string,
  medicationId: string,
  opts: { fromDay?: number; toDay?: number; stepDays?: number } = {}
): Promise<{
  drugId: string | null;
  drugName?: string | null;
  curve: SerumPoint[];
  currentLevelFraction: number | null;
  /** Day positions (relative to the curve anchor) of each logged injection, for chart markers. */
  doseDays: number[];
  /**
   * ISO timestamp of day 0 (the earliest injection in the window), so clients can
   * render the curve against real dates instead of day offsets. Null when there is
   * no curve to anchor.
   */
  anchorDate: string | null;
  /**
   * Why there is no curve, so the client can say what is actually missing instead of
   * defaulting to "log some injections". Null when a curve was produced.
   */
  unavailableReason: SerumCurveUnavailableReason | null;
  disclaimer: string;
}> {
  const med = await medicationRepository.getMedicationById(
    userId,
    medicationId
  );
  if (!med) {
    throw new Error('Medication not found');
  }
  let profile =
    resolveGlp1Profile(med.name) ??
    (med.custom_fields?.glp1_drug
      ? resolveGlp1Profile(String(med.custom_fields.glp1_drug))
      : undefined);

  // A custom drug models only when the user told us its half-life. Defaulting that (this used
  // to be `|| 7`) hands any peptide with no published PK a semaglutide-shaped curve and renders
  // it as confidently as a real one — a fabricated number on a medication record.
  let missingHalfLife = false;
  if (!profile && med.custom_fields?.glp1_drug === 'custom') {
    const halfLifeDays = positivePkValue(
      med.custom_fields?.custom_half_life_days
    );
    if (halfLifeDays === null) {
      missingHalfLife = true;
    } else {
      profile = {
        id: 'custom',
        displayName:
          (med.custom_fields?.custom_glp1_name as string) ||
          med.name ||
          'Custom GLP-1',
        brands: [],
        halfLifeDays,
        tMaxDays:
          positivePkValue(med.custom_fields?.custom_t_max_days) ??
          DEFAULT_CUSTOM_T_MAX_DAYS,
        cadence:
          (med.custom_fields?.custom_cadence as 'weekly' | 'daily') || 'weekly',
      };
    }
  }

  const injections = (await injectionRepository.listInjections(userId, {
    medicationId,
    limit: 60,
  })) as InjectionRow[];

  const disclaimer =
    'Modeled estimate from published half-lives — not a measured blood level.';

  if (!profile || injections.length === 0) {
    return {
      drugId: profile?.id ?? null,
      drugName: profile?.displayName ?? null,
      curve: [],
      currentLevelFraction: null,
      doseDays: [],
      anchorDate: null,
      unavailableReason: missingHalfLife
        ? 'no_half_life'
        : !profile
          ? 'no_profile'
          : 'no_injections',
      disclaimer,
    };
  }

  // Anchor day 0 at the earliest injection in the window.
  const sorted = [...injections].sort(
    (a, b) =>
      new Date(a.injected_at).getTime() - new Date(b.injected_at).getTime()
  );
  const anchor = new Date(sorted[0].injected_at);
  const doses: DoseEvent[] = sorted.map((inj) => ({
    day: daysBetween(new Date(inj.injected_at), anchor),
    doseMg:
      inj.dose_mg !== null && inj.dose_mg !== undefined
        ? Number(inj.dose_mg)
        : 1,
  }));

  const lastDay = doses[doses.length - 1].day;
  const fromDay = opts.fromDay ?? 0;
  const toDay = opts.toDay ?? lastDay + profile.halfLifeDays * 2;
  const stepDays = opts.stepDays ?? 0.25;

  const curve = simulateSerumCurve(doses, profile, fromDay, toDay, stepDays);

  const nowDay = daysBetween(new Date(), anchor);
  const peak = curve.reduce((m, p) => Math.max(m, p.level), 0) || 1;
  const currentLevelFraction =
    nowDay >= fromDay && nowDay <= toDay
      ? serumLevelAt(nowDay, doses, profile) / peak
      : null;

  const doseDays = doses.map((d) => Number(d.day.toFixed(2)));

  return {
    drugId: profile.id,
    drugName: profile.displayName,
    curve,
    currentLevelFraction,
    doseDays,
    anchorDate: anchor.toISOString(),
    unavailableReason: null,
    disclaimer,
  };
}

/**
 * Suggest the next injection site for a medication based on recent injection history,
 * flagging sites that are still resting (lipohypertrophy guidance).
 */
async function getSiteSuggestion(
  userId: string,
  medicationId: string
): Promise<
  SiteRotationResult & {
    sites: typeof INJECTION_SITES;
    restDays: number;
    activeSiteIds: string[] | null;
  }
> {
  const injections = (await injectionRepository.listInjections(userId, {
    medicationId,
    limit: 30,
  })) as InjectionRow[];

  const now = new Date();
  const recent: RecentSiteUse[] = injections
    .filter((i): i is InjectionRow & { site: string } => Boolean(i.site))
    .map((i) => ({
      siteId: i.site,
      daysAgo: daysBetween(now, new Date(i.injected_at)),
    }));

  // Honor the user's customized injection-site set/order (Settings → injection_sites pref).
  const prefs =
    await medicationDisplayPreferenceRepository.getMedicationDisplayPreferences(
      userId
    );
  const sitePref = prefs.find(
    (p: { view_group: string; visible_items: unknown }) =>
      p.view_group === 'injection_sites'
  );
  const activeSiteIds =
    Array.isArray(sitePref?.visible_items) && sitePref.visible_items.length
      ? (sitePref.visible_items as string[])
      : null;

  const result = suggestNextSite(recent, activeSiteIds ?? undefined);
  return {
    ...result,
    sites: INJECTION_SITES,
    restDays: SITE_REST_DAYS,
    activeSiteIds,
  };
}

export { getSerumCurve, getSiteSuggestion };
export default { getSerumCurve, getSiteSuggestion };
