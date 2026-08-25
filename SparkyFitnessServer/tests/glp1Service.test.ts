import { vi, beforeEach, describe, expect, it } from 'vitest';
import injectionRepository from '../models/injectionRepository.js';
import medicationRepository from '../models/medicationRepository.js';
import glp1Service from '../services/glp1Service.js';

vi.mock('../models/injectionRepository.js');
vi.mock('../models/medicationRepository.js');

const USER_ID = 'user-1';
const MED_ID = 'med-1';

// `name` has to resolve to a real GLP-1 profile, otherwise the service short-circuits
// to the empty-curve branch before it ever computes an anchor.
const OZEMPIC = {
  id: MED_ID,
  name: 'Ozempic',
  custom_fields: null,
};

function mockInjections(injectedAt: string[]) {
  vi.mocked(injectionRepository.listInjections).mockResolvedValue(
    injectedAt.map((at, i) => ({
      id: `inj-${i}`,
      injected_at: at,
      site: null,
      dose_mg: 1,
    })) as never
  );
}

describe('glp1Service.getSerumCurve — anchorDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      OZEMPIC as never
    );
  });

  it('anchors day 0 at the earliest injection', async () => {
    mockInjections([
      '2026-03-10T09:00:00.000Z',
      '2026-03-03T09:00:00.000Z',
      '2026-03-17T09:00:00.000Z',
    ]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBe('2026-03-03T09:00:00.000Z');
  });

  it('anchors on the earliest injection even when rows arrive out of order', async () => {
    mockInjections([
      '2026-05-20T12:00:00.000Z',
      '2026-05-06T12:00:00.000Z',
      '2026-05-13T12:00:00.000Z',
    ]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBe('2026-05-06T12:00:00.000Z');
  });

  it('places each doseDay at the offset the anchor implies', async () => {
    mockInjections([
      '2026-03-03T09:00:00.000Z',
      '2026-03-10T09:00:00.000Z',
      '2026-03-17T09:00:00.000Z',
    ]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    // Weekly dosing anchored at the first shot: day 0, 7 and 14. This is what lets a
    // client reconstruct real dates as anchorDate + day, so it has to stay in step.
    expect(result.doseDays).toEqual([0, 7, 14]);
    expect(result.anchorDate).toBe('2026-03-03T09:00:00.000Z');
  });

  it('returns a null anchor when there are no injections to anchor to', async () => {
    mockInjections([]);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBeNull();
    expect(result.curve).toEqual([]);
  });

  it('returns a null anchor when the drug is not a recognized GLP-1', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      id: MED_ID,
      name: 'Not A GLP-1',
      custom_fields: null,
    } as never);
    mockInjections(['2026-03-03T09:00:00.000Z']);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.anchorDate).toBeNull();
  });
});

/**
 * A custom GLP-1 used to fall back to `halfLifeDays: 7` when the user left the field blank,
 * which drew a confident, semaglutide-shaped curve for a drug nobody had published PK for.
 * The model now declines instead. These tests pin that it declines rather than defaults.
 */
describe('glp1Service.getSerumCurve — custom drug with no half-life', () => {
  function mockCustomMed(customFields: Record<string, unknown>) {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      id: MED_ID,
      // Deliberately not a name any profile resolves, so the custom branch is what runs.
      name: 'My Peptide',
      custom_fields: { glp1_drug: 'custom', ...customFields },
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockInjections([
      '2026-03-03T09:00:00.000Z',
      '2026-03-10T09:00:00.000Z',
      '2026-03-17T09:00:00.000Z',
    ]);
  });

  it.each([
    ['missing', {}],
    ['empty string', { custom_half_life_days: '' }],
    ['null', { custom_half_life_days: null }],
    ['zero', { custom_half_life_days: 0 }],
    ['negative', { custom_half_life_days: -3 }],
    ['non-numeric', { custom_half_life_days: 'about a week' }],
  ])('draws no curve when the half-life is %s', async (_label, fields) => {
    mockCustomMed(fields);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.curve).toEqual([]);
    expect(result.currentLevelFraction).toBeNull();
    expect(result.anchorDate).toBeNull();
    expect(result.unavailableReason).toBe('no_half_life');
  });

  it('models the curve when the user supplies a half-life', async () => {
    mockCustomMed({ custom_half_life_days: 6, custom_t_max_days: 1.5 });

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.drugId).toBe('custom');
    expect(result.curve.length).toBeGreaterThan(0);
    expect(result.unavailableReason).toBeNull();
    expect(result.anchorDate).toBe('2026-03-03T09:00:00.000Z');
  });

  it('accepts a numeric half-life supplied as a string', async () => {
    mockCustomMed({ custom_half_life_days: '6' });

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.curve.length).toBeGreaterThan(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('does not silently inherit a 7-day half-life', async () => {
    // The old fallback produced exactly the curve a 7-day half-life gives. If a future
    // change reintroduces a default, this comparison is what catches it.
    mockCustomMed({});
    const blank = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    mockCustomMed({ custom_half_life_days: 7 });
    const sevenDay = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(sevenDay.curve.length).toBeGreaterThan(0);
    expect(blank.curve).toEqual([]);
    expect(blank.curve).not.toEqual(sevenDay.curve);
  });

  it('still defaults time-to-peak, which only shapes the rising edge', async () => {
    mockCustomMed({ custom_half_life_days: 6 });

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.curve.length).toBeGreaterThan(0);
    expect(result.unavailableReason).toBeNull();
  });

  it('distinguishes no-injections from no-half-life', async () => {
    mockInjections([]);
    mockCustomMed({ custom_half_life_days: 6 });

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.curve).toEqual([]);
    expect(result.unavailableReason).toBe('no_injections');
  });

  it('reports an unrecognized drug as no_profile', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue({
      id: MED_ID,
      name: 'Not A GLP-1',
      custom_fields: null,
    } as never);

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.unavailableReason).toBe('no_profile');
  });

  it('reports null on a curve that was produced', async () => {
    vi.mocked(medicationRepository.getMedicationById).mockResolvedValue(
      OZEMPIC as never
    );

    const result = await glp1Service.getSerumCurve(USER_ID, MED_ID);

    expect(result.curve.length).toBeGreaterThan(0);
    expect(result.unavailableReason).toBeNull();
  });
});
