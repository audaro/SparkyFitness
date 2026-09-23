import { vi, beforeEach, describe, expect, it } from 'vitest';

// Regression cover for issue #2471: syncPolarData deduplicated the daily-activity
// window with `new Map(acts.map((a) => [a.date, a]))`, but Polar's
// /users/activities records carry start_time/end_time and no `date`. Every entry
// keyed to undefined, so 28 days of steps collapsed into a single record before
// the processor ever saw them.

const { polarIntegration, processor, systemClient } = vi.hoisted(() => {
  // polarService reads this at module scope, and the repo .env that vitest
  // injects may pin it to "local". Force the live sync path, which is the one
  // that dedups (the local replay path does not, which is why local testing
  // hid this bug in the first place).
  process.env.SPARKY_FITNESS_POLAR_DATA_SOURCE = 'polar';
  return {
    polarIntegration: {
      getValidAccessToken: vi.fn(),
      fetchPhysicalInfo: vi.fn(),
      fetchExercises: vi.fn(),
      fetchDailyActivity: vi.fn(),
      fetchUserProfile: vi.fn(),
      fetchRecentSleepData: vi.fn(),
      fetchRecentNightlyRecharge: vi.fn(),
    },
    processor: {
      processPolarExercises: vi.fn(),
      processPolarPhysicalInfo: vi.fn(),
      processPolarActivity: vi.fn(),
      processPolarSleep: vi.fn(),
      processPolarNightlyRecharge: vi.fn(),
    },
    systemClient: { query: vi.fn(), release: vi.fn() },
  };
});

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../utils/diagnosticLogger.js', () => ({ loadRawBundle: vi.fn() }));
vi.mock('../db/poolManager.js', () => ({
  getSystemClient: vi.fn(async () => systemClient),
}));
vi.mock('../integrations/polar/polarService.js', () => ({
  default: polarIntegration,
}));
// The real helpers are pure and are what the service under test relies on to
// resolve a day; only the processors are stubbed out.
vi.mock(
  '../integrations/polar/polarDataProcessor.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../integrations/polar/polarDataProcessor.js')
      >();
    return {
      default: {
        ...processor,
        resolvePolarActivityDate: actual.resolvePolarActivityDate,
        resolvePolarActivitySteps: actual.resolvePolarActivitySteps,
      },
    };
  }
);

const { default: polarService } = await import('../services/polarService.js');

const UID = 'user-1';

// The eight days from the reporter's payload (mock_data/polar_raw.json).
const PAYLOAD = [
  ['2026-09-08T13:20', 2974],
  ['2026-09-09T00:00', 3915],
  ['2026-09-10T00:00', 6044],
  ['2026-09-11T00:00', 5016],
  ['2026-09-12T00:00', 6266],
  ['2026-09-13T00:00', 8154],
  ['2026-09-14T00:00', 4762],
  ['2026-09-15T00:00', 3445],
] as const;

const activities = () =>
  PAYLOAD.map(([start_time, steps]) => ({ start_time, steps }));

beforeEach(() => {
  vi.clearAllMocks();
  polarIntegration.getValidAccessToken.mockResolvedValue({
    accessToken: 'token',
    externalUserId: 'polar-1',
  });
  polarIntegration.fetchPhysicalInfo.mockResolvedValue([]);
  polarIntegration.fetchExercises.mockResolvedValue([]);
  polarIntegration.fetchRecentSleepData.mockResolvedValue([]);
  polarIntegration.fetchRecentNightlyRecharge.mockResolvedValue([]);
  systemClient.query.mockResolvedValue({ rows: [] });
});

describe('syncPolarData daily-activity dedup (issue #2471)', () => {
  it('keeps every day of the window instead of collapsing it to one', async () => {
    polarIntegration.fetchDailyActivity.mockResolvedValue(activities());

    await polarService.syncPolarData(UID, 'scheduled', 'provider-1');

    expect(processor.processPolarActivity).toHaveBeenCalledTimes(1);
    const passed = processor.processPolarActivity.mock.calls[0][2];
    expect(passed).toHaveLength(8);
    expect(passed.map((a: { start_time: string }) => a.start_time)).toEqual(
      PAYLOAD.map(([start_time]) => start_time)
    );
  });

  it('keeps the highest step count when a day reports several periods', async () => {
    polarIntegration.fetchDailyActivity.mockResolvedValue([
      { start_time: '2026-09-13T00:00', steps: 3000 },
      { start_time: '2026-09-13T12:00', steps: 8154 },
      { start_time: '2026-09-13T18:00', steps: 5000 },
    ]);

    await polarService.syncPolarData(UID, 'scheduled', 'provider-1');

    const passed = processor.processPolarActivity.mock.calls[0][2];
    expect(passed).toHaveLength(1);
    expect(passed[0].steps).toBe(8154);
  });

  it('drops records with neither date nor start_time', async () => {
    polarIntegration.fetchDailyActivity.mockResolvedValue([
      { start_time: '2026-09-13T00:00', steps: 8154 },
      { end_time: '2026-09-14T23:56', steps: 4762 },
    ]);

    await polarService.syncPolarData(UID, 'scheduled', 'provider-1');

    const passed = processor.processPolarActivity.mock.calls[0][2];
    expect(passed).toHaveLength(1);
    expect(passed[0].steps).toBe(8154);
  });
});
