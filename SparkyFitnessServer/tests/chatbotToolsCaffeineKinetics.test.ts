import { vi, beforeEach, describe, expect, it } from 'vitest';
import { todayInZone } from '@workspace/shared';
import { buildCaffeineKineticsTools } from '../ai/tools/caffeineKineticsTools.js';
import { getActiveCaffeineKinetics } from '../services/caffeineKineticsService.js';
import goalService from '../services/goalService.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';

vi.mock('../services/caffeineKineticsService.js', () => ({
  getActiveCaffeineKinetics: vi.fn(),
}));
vi.mock('../services/goalService.js', () => ({
  default: { getUserGoals: vi.fn() },
}));
vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

const svc = { getActiveCaffeineKinetics: vi.mocked(getActiveCaffeineKinetics) };
const goals = { getUserGoals: vi.mocked(goalService.getUserGoals) };

const opts = toolOpts;
const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';

const KINETICS_RESULT = {
  half_life_hours: 5,
  target_bedtime: '22:30',
  bedtime_at: '2026-02-01T22:30:00.000Z',
  doses: [{ at: '2026-02-01T14:00:00.000Z', mg: 95, name: 'Coffee' }],
  active_mg_now: 60,
  at_bedtime_mg: 12,
  latest_safe_dose_time: '16:45',
  cutoff_state: 'by' as const,
  bedtime_headroom_mg: 88,
  cutoff_dose_mg: 200,
  threshold_mg: 100,
  has_estimated_times: false,
};

// The service response as it reaches the model: bedtime_at dropped (redundant
// with target_bedtime, which is already local), each dose's raw UTC `at`
// replaced with a local date + time, and the day's logged total plus goal
// (none set, here) appended.
const EXPECTED_CHAT_RESULT = {
  half_life_hours: 5,
  target_bedtime: '22:30',
  active_mg_now: 60,
  at_bedtime_mg: 12,
  latest_safe_dose_time: '16:45',
  cutoff_state: 'by',
  bedtime_headroom_mg: 88,
  cutoff_dose_mg: 200,
  threshold_mg: 100,
  has_estimated_times: false,
  doses: [{ mg: 95, name: 'Coffee', date: '2026-02-01', time: '14:00' }],
  total_mg_for_date: 95,
  daily_goal_mg: null,
};

let tools: ReturnType<typeof buildCaffeineKineticsTools>;

beforeEach(() => {
  vi.clearAllMocks();
  goals.getUserGoals.mockResolvedValue({ caffeine_mg: null });
  tools = buildCaffeineKineticsTools('user-1', 'UTC');
});

// #1958: caffeine_half_life_hours and target_bedtime power an existing
// active-caffeine/bedtime-impact estimate (services/caffeineKineticsService.ts,
// routes/v2/nutritionKineticsRoutes.ts), but nothing in ai/tools/ wrapped it,
// so Sparky had no way to answer "how much caffeine will still be active at
// my bedtime?" even though the feature itself already worked on web/mobile.
describe('sparky_get_caffeine_kinetics', () => {
  it('active_caffeine returns the kinetics estimate for an explicit date', async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue(KINETICS_RESULT);

    const result = await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01' },
      opts
    );

    expect(result).toBe(JSON.stringify(EXPECTED_CHAT_RESULT));
    expect(svc.getActiveCaffeineKinetics).toHaveBeenCalledWith('user-1', {
      date: '2026-02-01',
      doseMg: undefined,
    });
    expect(goals.getUserGoals).toHaveBeenCalledWith(
      'user-1',
      '2026-02-01',
      undefined,
      true
    );
  });

  // Regression: the service returns doses[].at (and bedtime_at) as raw UTC
  // instants for its own timezone-agnostic math. Handing that straight to a
  // model made it guess at a local time itself -- and get it wrong -- since
  // it has no reliable way to apply the user's offset. date/time must
  // reflect the tool's own tz, not the raw UTC digits of the instant.
  it("converts each dose's date and time to the tool's timezone, not the raw UTC hour", async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue({
      ...KINETICS_RESULT,
      // 2026-02-01T02:00 UTC is 2026-01-31 21:00 in America/New_York
      // (UTC-5 in February): a case that crosses a calendar day too.
      doses: [{ at: '2026-02-01T02:00:00.000Z', mg: 95, name: 'Coffee' }],
    });
    const nyTools = buildCaffeineKineticsTools('user-1', 'America/New_York');

    const result = await nyTools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01' },
      opts
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.doses).toEqual([
      { mg: 95, name: 'Coffee', date: '2026-01-31', time: '21:00' },
    ]);
    expect(parsed.at).toBeUndefined();
    expect(parsed.bedtime_at).toBeUndefined();
  });

  // Regression: the 48h lookback window can return a dose from a day before
  // the requested one (still-active caffeine carries over), and a bare time
  // with no date read as "today" for all of them -- confusing when one was
  // actually logged yesterday. Each dose must carry its own date so a
  // multi-day list is unambiguous.
  it('labels a dose from the prior day with its own date, not the requested date', async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue({
      ...KINETICS_RESULT,
      doses: [
        { at: '2026-01-31T23:50:00.000Z', mg: 95, name: 'Late coffee' },
        { at: '2026-02-01T08:00:00.000Z', mg: 100, name: 'Morning shake' },
      ],
    });

    const result = await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01' },
      opts
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.doses).toEqual([
      { mg: 95, name: 'Late coffee', date: '2026-01-31', time: '23:50' },
      { mg: 100, name: 'Morning shake', date: '2026-02-01', time: '08:00' },
    ]);
    // total_mg_for_date sums only the requested date's doses, not the whole
    // lookback window -- the prior-day dose still counts toward "active now"
    // math but must not inflate the day's own logged total.
    expect(parsed.total_mg_for_date).toBe(100);
  });

  // Regression: latest_safe_dose_time/cutoff_state only ever answered
  // "would a dose clear by bedtime" -- a sleep question with no idea of the
  // user's daily caffeine goal. The model then framed a cutoff time as an
  // invitation for "another boost" even when the user had already logged
  // more than their goal for the day. daily_goal_mg (and the day's own
  // total, not the multi-day lookback sum) let the model catch that.
  it("includes the day's logged total and the user's caffeine goal", async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue({
      ...KINETICS_RESULT,
      doses: [
        { at: '2026-02-01T11:53:00.000Z', mg: 144, name: 'Dunkin Zero' },
        { at: '2026-02-01T12:11:00.000Z', mg: 100, name: 'Protein Shake' },
      ],
    });
    goals.getUserGoals.mockResolvedValue({ caffeine_mg: 200 });

    const result = await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01' },
      opts
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.total_mg_for_date).toBe(244);
    expect(parsed.daily_goal_mg).toBe(200);
  });

  it('passes a custom dose_mg through for the cutoff calculation', async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue(KINETICS_RESULT);

    await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01', dose_mg: 80 },
      opts
    );

    expect(svc.getActiveCaffeineKinetics).toHaveBeenCalledWith('user-1', {
      date: '2026-02-01',
      doseMg: 80,
    });
  });

  it('defaults to today (UTC) when no date is given', async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue(KINETICS_RESULT);
    const today = todayInZone('UTC');

    const result = await tools.sparky_get_caffeine_kinetics.execute!({}, opts);

    // The mocked dose is fixed at 2026-02-01, which is not "today" here, so
    // total_mg_for_date is correctly 0 rather than the dose's 95mg.
    expect(result).toBe(
      JSON.stringify({ ...EXPECTED_CHAT_RESULT, total_mg_for_date: 0 })
    );
    expect(svc.getActiveCaffeineKinetics).toHaveBeenCalledWith('user-1', {
      date: today,
      doseMg: undefined,
    });
    expect(goals.getUserGoals).toHaveBeenCalledWith(
      'user-1',
      today,
      undefined,
      true
    );
  });

  it('rejects malformed dates', async () => {
    const result = await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '02/01/2026' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: date: Date must be in YYYY-MM-DD format (or "today", "yesterday", "tomorrow")'
    );
  });

  it('returns a DB error string when the service throws', async () => {
    svc.getActiveCaffeineKinetics.mockRejectedValue(new Error('boom'));

    const result = await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01' },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });

  // Regression: the goal fetch used to share Promise.all with kinetics, so
  // a goals outage turned the whole bedtime estimate into DB_ERROR even
  // though daily_goal_mg is only advisory. Degrade to null and still
  // return the kinetics payload.
  it('degrades daily_goal_mg to null when the goals fetch fails', async () => {
    svc.getActiveCaffeineKinetics.mockResolvedValue(KINETICS_RESULT);
    goals.getUserGoals.mockRejectedValue(new Error('goals down'));

    const result = await tools.sparky_get_caffeine_kinetics.execute!(
      { action: 'active_caffeine', date: '2026-02-01' },
      opts
    );

    expect(result).toBe(JSON.stringify(EXPECTED_CHAT_RESULT));
    expect(svc.getActiveCaffeineKinetics).toHaveBeenCalled();
  });
});
