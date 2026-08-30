#!/usr/bin/env node
/**
 * Give the QA account one gym equipment profile, inactive.
 *
 * WHAT IT IS FOR. The gym chip on Up Next is one of three controls that
 * regenerate the workout, and it is the only one no scenario could reach: the
 * picker lists the account's profiles, and the QA account had none, so the chip
 * offered nothing but "Any equipment" and tapping it changed nothing. One
 * profile is all it takes to make the control real.
 *
 * WHY IT IS SEEDED INACTIVE. The generator falls back to the *active* profile
 * when a request names none. A profile that arrived already active would be
 * picked up by the very first generate, and the switch the scenario is there to
 * test would be a no-op dressed as a pass. Inactive, the first workout is built
 * with no gym at all and the switch is a real change of state — which is also
 * what `handleSelectGym` does in the app: activate the profile, then regenerate
 * naming it.
 *
 * WHY ITS EQUIPMENT DOES NOT MATTER, and must not be made to. The seeded
 * exercise catalog is entirely `body only`, which is ALWAYS_AVAILABLE_EQUIPMENT
 * in the shared taxonomy — performable under every profile, including this one,
 * which stocks a single dumbbell rack the catalog never asks for. So the
 * workout is expected to come back UNCHANGED across the switch, and that is the
 * point: with the plan held still, the only thing the assertion can be reading
 * is whether the request carried the workout's own muscles and length forward.
 * A profile that changed the plan would confound the two.
 *
 * Created through the real API with a real session, like qa-exercise-catalog.mjs
 * and for the same reason: rows written behind the server's back stop resembling
 * rows the app makes the moment the endpoint gains a column.
 */
import { execFileSync } from 'node:child_process';
import { qaSignIn } from './qa-session.mjs';
import { QA_GYM_PROFILE } from '../fixtures/gym-profile.mjs';

const { QA_DB_CONTAINER, QA_DB_USER, QA_DB_NAME, QA_DB_PASSWORD } = process.env;
if (!QA_DB_CONTAINER) {
  console.error('!! QA_DB_CONTAINER is unset — run this through qa-run.sh, or source qa/bin/qa-env.sh first.');
  process.exit(1);
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${QA_DB_PASSWORD}`, QA_DB_CONTAINER,
      'psql', '-U', QA_DB_USER, '-d', QA_DB_NAME, '-t', '-A', '-c', query],
    { encoding: 'utf8' }
  ).trim();
}

const { token, serverUrl } = await qaSignIn();

const created = await fetch(`${serverUrl}/api/gym-equipment-profiles`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: serverUrl,
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    name: QA_GYM_PROFILE.name,
    equipment: QA_GYM_PROFILE.equipment,
    // Explicit rather than omitted. Omitting it would also leave the profile
    // inactive today, but "inactive" is a requirement of this fixture and not a
    // default worth inheriting — see the header.
    is_active: false,
  }),
});
if (!created.ok) {
  console.error(`!! could not create the gym profile (${created.status}): ${await created.text()}`);
  process.exit(1);
}

// --- verify, from the database ----------------------------------------------
// A 200 from the API under test is not evidence about the API under test, and
// two of the three facts asserted here are ones the response body would happily
// agree with while the row said otherwise.
const [id, isActive, total] = sql(
  `SELECT p.id, p.is_active,
          (SELECT count(*) FROM gym_equipment_profiles)
     FROM gym_equipment_profiles p
    WHERE p.name = '${QA_GYM_PROFILE.name}'`
).split('|');

if (!id) {
  console.error(`!! no gym_equipment_profiles row named "${QA_GYM_PROFILE.name}" after creating it.`);
  process.exit(1);
}
if (isActive !== 'f') {
  console.error('!! the seeded gym profile is active; the scenario needs it inactive so the first generate uses no gym.');
  process.exit(1);
}
// Exactly one, for the same reason the catalog counts the whole exercises
// table: the oracle identifies the profile by being the only one there is, and
// a second row would make "the workout was built with the seeded gym" a claim
// about whichever row happened to sort first.
if (Number(total) !== 1) {
  console.error(`!! expected exactly 1 gym profile after seeding, found ${total}.`);
  console.error('   Anything extra means the reset did not empty the table.');
  process.exit(1);
}

console.log(`==> seeded gym profile "${QA_GYM_PROFILE.name}" (inactive, stocking ${QA_GYM_PROFILE.equipment.join(', ') || 'nothing'})`);
