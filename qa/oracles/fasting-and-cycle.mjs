#!/usr/bin/env node
/**
 * The verdict for qa/flows/fasting-and-cycle.yaml.
 *
 * That flow opts an account into two features and walks the five screens they
 * unlock. Opting in is a write like any other, and every one of these rows
 * renders plausibly when it is wrong: a fast started with the wrong goal still
 * draws a ring, an onboarding that seeded no period days still shows a hub,
 * and a pregnancy dated today still counts weeks. So the screens are judged by
 * app-logs.mjs and the state behind them is judged here.
 *
 * The failure modes it is built around:
 *   - the protocol sheet starts the fast the flow did not pick (the rows are
 *     one tap apart, and the goal is the only thing that tells them apart);
 *   - onboarding writes the settings but not the period days, so every
 *     prediction on the hub is derived from nothing;
 *   - saving the log modal replaces today's seeded row rather than editing it,
 *     dropping the flow level onboarding wrote;
 *   - the due date is saved as the day the form was opened, which is the bug
 *     the +280-day default exists to prevent.
 */
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';

const report = createReport('fasting-and-cycle');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// Everything the flow chose or typed, in one place, so the flow and the oracle
// can be read against each other.
const EXPECTED = {
  fastingType: '16:8 Leangains',
  fastingGoalHours: 16,
  // CycleOnboardingScreen's own defaults, which the flow accepts rather than
  // picking: Standard Cycle, a last period of today, 28 and 5.
  cycleLength: 28,
  periodLength: 5,
  // The mode the flow leaves behind, which is NOT the one it onboarded with:
  // PregnancySetup only exists in pregnancy mode, so the last thing the flow
  // does to the settings is switch them over.
  finalMode: 'pregnant',
  note: 'QA harness cycle note',
  // PregnancyDueDateForm seeds a plain due date a full term out.
  dueDateOffsetDays: 280,
  fetusCount: 1,
};

// The app dates a row by the device's calendar day, and the simulator shares
// this machine's timezone — so the expected day is the local one. Deriving it
// from `toISOString()` would be the very timezone bug this check exists to
// catch, in the checker.
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const today = dayFormat.format(new Date());
const dayFromToday = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return dayFormat.format(d);
};

const num = (v) => (v === null || v === undefined ? null : Number(v));

// --- the fast ---------------------------------------------------------------
const fasts = query(`
  SELECT id, fasting_type, status,
         end_time,
         start_time::text AS start_time,
         EXTRACT(EPOCH FROM (target_end_time - start_time)) / 3600 AS goal_hours
  FROM fasting_logs
  WHERE user_id = ${lit(userId)}
`);
if (
  report.check(
    'fast.started',
    fasts.length === 1 && fasts[0].status === 'ACTIVE' && fasts[0].end_time === null,
    fasts.length === 1
      ? `one fast, status=${fasts[0].status}, end_time=${fasts[0].end_time}`
      : `${fasts.length} fasting log(s) for the QA user (expected 1)`,
    fasts
  )
) {
  const fast = fasts[0];
  // The goal is the whole content of a fast: the server stores the preset name
  // as an opaque string and derives every hour on screen from
  // target_end_time - start_time, so a 16 here is the only evidence the flow
  // picked the protocol it meant to.
  report.check(
    'fast.goal-matches-the-protocol',
    num(fast.goal_hours) === EXPECTED.fastingGoalHours &&
      fast.fasting_type === EXPECTED.fastingType,
    `"${fast.fasting_type}", ${fast.goal_hours}h goal` +
      ` (expected "${EXPECTED.fastingType}", ${EXPECTED.fastingGoalHours}h)`,
    fast
  );
}

// --- the cycle settings -----------------------------------------------------
const settings = query(`
  SELECT id, enabled, mode, avg_cycle_length_override, avg_period_length_override,
         birth_control_method, conditions, onboarded_at
  FROM cycle_settings
  WHERE user_id = ${lit(userId)}
`);
if (
  !report.check(
    'cycle.settings-row',
    settings.length === 1 && settings[0].enabled === true,
    settings.length === 1
      ? `one settings row, enabled=${settings[0].enabled}`
      : `${settings.length} cycle settings row(s) (expected 1)`,
    settings
  )
) {
  // Every screen below this one is gated on the row: without it the rest of
  // the report is a cascade burying the one finding that matters.
  report.finish(runDir);
}
const cycle = settings[0];

// onboarded_at is what the dashboard card is keyed on: an account with the
// setting on but no timestamp is offered setup again, which means the wizard
// looked complete and wrote nothing.
report.check(
  'cycle.onboarding-completed',
  cycle.onboarded_at !== null,
  cycle.onboarded_at !== null
    ? `onboarded at ${cycle.onboarded_at}`
    : 'the wizard finished but left onboarded_at null',
  cycle
);
report.check(
  'cycle.onboarding-values',
  num(cycle.avg_cycle_length_override) === EXPECTED.cycleLength &&
    num(cycle.avg_period_length_override) === EXPECTED.periodLength &&
    cycle.birth_control_method === 'none',
  `saved ${cycle.avg_cycle_length_override}-day cycle / ${cycle.avg_period_length_override}-day period,` +
    ` birth control "${cycle.birth_control_method}"` +
    ` (expected ${EXPECTED.cycleLength} / ${EXPECTED.periodLength} / "none")`,
  cycle
);
report.check(
  'cycle.mode-switched',
  cycle.mode === EXPECTED.finalMode,
  `mode is "${cycle.mode}" (expected "${EXPECTED.finalMode}" — onboarding wrote "standard"` +
    ' and the picker changed it afterwards)',
  cycle
);

// --- the period days onboarding seeded --------------------------------------
// Five rows from the last period start, the first one medium and the rest
// light: the wizard writes them itself so the hub has something to predict
// from, and they are the only reason its ring shows a cycle day at all.
const entries = query(`
  SELECT entry_date::text AS entry_date, flow_level, notes
  FROM cycle_daily_entries
  WHERE user_id = ${lit(userId)}
  ORDER BY entry_date
`);
const expectedDays = Array.from({ length: EXPECTED.periodLength }, (_, i) => dayFromToday(i));
report.check(
  'cycle.period-days-seeded',
  entries.length === EXPECTED.periodLength &&
    entries.every((e, i) => e.entry_date === expectedDays[i]) &&
    entries[0]?.flow_level === 'medium' &&
    entries.slice(1).every((e) => e.flow_level === 'light'),
  entries.length === EXPECTED.periodLength
    ? `${entries.length} days from ${entries[0].entry_date}, flow ${entries.map((e) => e.flow_level).join('/')}`
    : `${entries.length} cycle day(s) (expected ${EXPECTED.periodLength}, starting ${today})`,
  entries
);

// The log modal saved onto a day that already had a seeded row, so this is
// both "the note was written" and "writing it did not throw away what the
// wizard had put there".
const todayEntry = entries.find((e) => e.entry_date === today);
report.check(
  'cycle.note-edits-rather-than-replaces',
  Boolean(todayEntry) &&
    todayEntry.notes === EXPECTED.note &&
    todayEntry.flow_level === 'medium',
  todayEntry
    ? `today reads notes="${todayEntry.notes}", flow="${todayEntry.flow_level}"` +
      ` (expected "${EXPECTED.note}" and the seeded "medium")`
    : `no cycle entry for today (${today})`,
  todayEntry ?? entries
);

// --- the pregnancy ----------------------------------------------------------
const pregnancies = query(`
  SELECT id, due_date::text AS due_date, due_date_basis, fetus_count, status
  FROM pregnancies
  WHERE user_id = ${lit(userId)}
`);
if (
  report.check(
    'pregnancy.created',
    pregnancies.length === 1 && pregnancies[0].status === 'active',
    pregnancies.length === 1
      ? `one pregnancy, status=${pregnancies[0].status}`
      : `${pregnancies.length} pregnanc(y/ies) for the QA user (expected 1)`,
    pregnancies
  )
) {
  const pregnancy = pregnancies[0];
  const expectedDueDate = dayFromToday(EXPECTED.dueDateOffsetDays);
  report.check(
    'pregnancy.due-date-is-a-full-term-out',
    pregnancy.due_date === expectedDueDate &&
      pregnancy.due_date_basis === 'manual' &&
      num(pregnancy.fetus_count) === EXPECTED.fetusCount,
    `due ${pregnancy.due_date} by "${pregnancy.due_date_basis}", ${pregnancy.fetus_count} baby` +
      ` (expected ${expectedDueDate}, "manual", ${EXPECTED.fetusCount})`,
    pregnancy
  );
}

report.finish(runDir);
