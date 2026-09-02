#!/usr/bin/env node
/**
 * The verdict for qa/flows/workout-proposal.yaml.
 *
 * The screen shows a card and a "Saved ✓" badge. Neither says whether the
 * routine the model proposed is the routine that was written, whether the
 * exercise ids on it were real ones the search returned or ones the model
 * made up, or whether the server actually ran the three-turn loop rather than
 * short-circuiting somewhere. So this reads three things and holds them
 * against one fixture (qa/fixtures/workout-proposal.mjs):
 *
 *   the MODEL LOOP ran   — the stub's request log shows the turns in order:
 *                          the user's exact message, then a request carrying
 *                          the search result, then the acceptance. The first
 *                          user text must equal USER_MESSAGE, which is how the
 *                          flow's typed string is kept honest with the fixture;
 *   the PRESET is right  — exactly one preset for the QA user, with the
 *                          fixture's name and description, its exercises in
 *                          order and every set's reps, weight and rest as
 *                          programmed. The exercise ids must be rows of the
 *                          seeded catalog with "chest" in the name — the ids
 *                          came from the server's own search, not the stub;
 *   the CARD persisted   — the assistant's history row carries the proposal
 *                          tool part, so the card can come back after reload.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';
import {
  ACCEPT_REPLY,
  PROGRAMMING,
  PROPOSAL_DESCRIPTION,
  PROPOSAL_NAME,
  SEARCH_QUERY,
  USER_MESSAGE,
} from '../fixtures/workout-proposal.mjs';

const report = createReport('workout-proposal');
const runDir = process.env.QA_RUN_DIR;
const stubLog = process.env.QA_AI_STUB_REQUESTS;
if (!runDir || !stubLog) {
  console.error('!! QA_RUN_DIR and QA_AI_STUB_REQUESTS must be set — run through qa-run.sh.');
  process.exit(1);
}
const { userId } = qaAccount();

// --- the model loop ---------------------------------------------------------
const requests = existsSync(stubLog)
  ? readFileSync(stubLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : [];
// The server's domain classifier is a model call too; it is not a reply turn.
const chatTurns = requests.filter((r) => r.chat && !r.chat.classifier);

report.check(
  'stub.three-turns',
  chatTurns.length >= 3,
  `the stub was asked ${chatTurns.length} chat turn(s); the loop needs search, propose and acknowledge`,
  chatTurns.map((t) => ({ lastUserText: t.chat.lastUserText, toolResults: t.chat.toolResults, reply: t.reply }))
);

const first = chatTurns[0];
report.check(
  'stub.user-message-verbatim',
  first?.chat?.lastUserText === USER_MESSAGE,
  'the first turn carried the message the flow typed, exactly as the fixture spells it',
  { got: first?.chat?.lastUserText, expected: USER_MESSAGE }
);
report.check(
  'stub.searched-first',
  first?.reply?.toolCalls?.[0]?.name === 'sparky_search_exercises' &&
    first?.reply?.toolCalls?.[0]?.args?.query === SEARCH_QUERY,
  'the model searched the library before proposing',
  first?.reply
);

const proposeTurn = chatTurns.find((t) => t.reply?.toolCalls?.[0]?.name === 'sparky_propose_workout_preset');
report.check(
  'stub.proposed-after-search-result',
  proposeTurn != null && proposeTurn.chat.toolResults >= 1,
  'the proposal was made on a turn that carried the search result back',
  proposeTurn?.chat
);
const proposedIds = proposeTurn?.reply?.toolCalls?.[0]?.args?.exercises?.map((e) => e.exercise_id) ?? [];
report.check(
  'stub.proposed-two-exercises',
  proposedIds.length === PROGRAMMING.length,
  `the proposal programmed ${proposedIds.length} exercise(s), expected ${PROGRAMMING.length}`,
  proposedIds
);

const acceptTurn = chatTurns.find((t) => /I accepted the proposed routine/.test(t.chat?.lastUserText ?? ''));
report.check(
  'stub.acceptance-reached-model',
  acceptTurn != null &&
    acceptTurn.chat.lastUserText.includes(`"${PROPOSAL_NAME}"`) &&
    acceptTurn.reply?.text === ACCEPT_REPLY,
  'accepting the card sent the acceptance to the model, naming the routine, and got the acknowledgement back',
  { lastUserText: acceptTurn?.chat?.lastUserText, reply: acceptTurn?.reply }
);

// The client keys tool parts by call id, so a stub that repeats an id would
// merge the proposal into the search's part — the card would never render and
// the flow would fail with nothing pointing at the stub. Hold the ids apart.
const issuedIds = chatTurns.flatMap((t) => t.toolCallIds ?? []);
report.check(
  'stub.tool-call-ids-distinct',
  issuedIds.length >= 2 && new Set(issuedIds).size === issuedIds.length,
  `the stub issued ${issuedIds.length} tool call id(s), all distinct`,
  issuedIds
);

report.check(
  'stub.photo-path-untouched',
  requests.every((r) => r.chat || r.unexpected || r.error),
  'no request took the photo-estimate branch',
  requests.filter((r) => !r.chat && !r.unexpected && !r.error)
);

// --- the preset ---------------------------------------------------------------
const presets = query(
  `SELECT id, name, description, is_public FROM workout_presets WHERE user_id = ${lit(userId)} ORDER BY id`
);
report.check(
  'preset.exactly-one',
  presets.length === 1,
  `the QA user has ${presets.length} preset(s); accepting once must create exactly one`,
  presets
);
const preset = presets[0];
report.check(
  'preset.name-and-description',
  preset?.name === PROPOSAL_NAME && preset?.description === PROPOSAL_DESCRIPTION && preset?.is_public === false,
  'the preset carries the proposed name and description and is private',
  preset
);

const exercises = preset
  ? query(
      `SELECT wpe.id, wpe.exercise_id, wpe.sort_order, wpe.superset_group, e.name
       FROM workout_preset_exercises wpe
       JOIN exercises e ON e.id = wpe.exercise_id
       WHERE wpe.workout_preset_id = ${preset.id}
       ORDER BY wpe.sort_order`
    )
  : [];
report.check(
  'preset.exercise-count',
  exercises.length === PROGRAMMING.length,
  `the preset has ${exercises.length} exercise(s), expected ${PROGRAMMING.length}`,
  exercises
);
report.check(
  'preset.exercise-order',
  exercises.length > 0 && exercises.every((e, i) => e.sort_order === i),
  'exercises are stored in the proposed order, 0-based and gap-free',
  exercises.map((e) => e.sort_order)
);
report.check(
  'preset.exercises-are-searched-catalog-rows',
  exercises.length > 0 &&
    exercises.every((e) => e.name.startsWith('QA Catalog ') && e.name.toLowerCase().includes(SEARCH_QUERY)),
  'every exercise on the preset is a seeded catalog row that the chest search would return',
  exercises.map((e) => e.name)
);
report.check(
  'preset.exercise-ids-match-proposal',
  exercises.length > 0 &&
    exercises.length === proposedIds.length &&
    exercises.every((e, i) => e.exercise_id === proposedIds[i]),
  'the saved exercise ids are the ones the card proposed, in the same order',
  { saved: exercises.map((e) => e.exercise_id), proposed: proposedIds }
);

for (const [index, exercise] of exercises.entries()) {
  const expected = PROGRAMMING[index]?.sets ?? [];
  const sets = query(
    `SELECT set_number, set_type, reps, weight, rest_time, duration, distance
     FROM workout_preset_exercise_sets
     WHERE workout_preset_exercise_id = ${exercise.id}
     ORDER BY set_number`
  );
  const matches =
    sets.length === expected.length &&
    sets.every(
      (s, i) =>
        s.set_number === expected[i].set_number &&
        s.set_type === expected[i].set_type &&
        s.reps === expected[i].reps &&
        Number(s.weight) === expected[i].weight &&
        s.rest_time === expected[i].rest_time &&
        s.duration == null &&
        s.distance == null
    );
  report.check(
    `preset.sets.${index}`,
    matches,
    `exercise ${index} ("${exercise.name}") has the ${expected.length} programmed set(s) with the proposed reps, kg and rest`,
    { saved: sets, expected }
  );
}

// --- the persisted card -------------------------------------------------------
const history = query(
  `SELECT message_type, parts FROM sparky_chat_history WHERE user_id = ${lit(userId)} ORDER BY created_at`
);
const proposalRows = history.filter(
  (row) =>
    row.message_type === 'assistant' &&
    Array.isArray(row.parts) &&
    row.parts.some((part) => part?.type === 'tool-sparky_propose_workout_preset')
);
report.check(
  'history.proposal-part-persisted',
  proposalRows.length === 1,
  `${proposalRows.length} assistant history row(s) carry the proposal tool part; the card reloads from exactly one`,
  history.map((row) => ({ type: row.message_type, parts: (row.parts ?? []).map((p) => p?.type) }))
);
const acceptRows = history.filter(
  (row) => row.message_type === 'user' && JSON.stringify(row).includes('I accepted the proposed routine')
);
report.check(
  'history.acceptance-persisted',
  acceptRows.length === 1,
  'the acceptance message is in the history once',
  acceptRows.length
);
// The flow cannot see this reply on screen (native markdown, no accessibility
// elements), so the persisted row is the evidence that the model's answer to
// the acceptance reached the user.
const replyRows = history.filter(
  (row) =>
    row.message_type === 'assistant' &&
    Array.isArray(row.parts) &&
    row.parts.some((part) => part?.type === 'text' && part?.text === ACCEPT_REPLY)
);
report.check(
  'history.acceptance-reply-persisted',
  replyRows.length === 1,
  `${replyRows.length} assistant history row(s) carry the acknowledgement text; expected exactly one`,
  history.filter((row) => row.message_type === 'assistant').map((row) => row.parts)
);

report.finish(runDir);
