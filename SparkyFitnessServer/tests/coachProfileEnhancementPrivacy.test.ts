import { describe, expect, it } from 'vitest';
import { renderCoachProfile } from '../ai/tools/coachProfileTools.js';
import { buildCoachProfileSummary } from '../services/chatService.js';
import type { CoachProfileRow } from '../models/coachProfileRepository.js';

/**
 * `coach_profiles.enhancement` records exogenous testosterone. It exists so the
 * lean-mass projection can be computed on the server and rendered by the user's
 * own app, and for no other reader.
 *
 * The chat provider is third-party, so this column must never appear in
 * anything sent to a model: not the `sparky_manage_coach_profile` read, and not
 * the profile summary embedded in every coaching system prompt. Both builders
 * assemble their text field by field rather than spreading the row, which is
 * what makes that true — these tests are what stops a later refactor to
 * `{...profile}` from quietly undoing it.
 *
 * They assert on the rendered strings, not on the builders' shape, so they keep
 * holding however the rendering is reorganised.
 */

const row: CoachProfileRow = {
  id: 'profile-1',
  user_id: 'owner-1',
  goals: 'Build muscle without aggravating my shoulder',
  training_days_per_week: 4,
  session_minutes: 60,
  experience_level: 'intermediate',
  primary_goal: 'build_muscle',
  physique_target: 'muscular',
  priority_muscle_groups: ['push', 'pull'],
  enhancement: {
    status: 'trt',
    testosterone_mg_per_dose: 137,
    ester: 'cypionate',
  },
  plan_completed_at: new Date('2026-09-15T10:00:00Z'),
  equipment: ['barbell', 'dumbbell'],
  limitations: ['left shoulder'],
  food_preferences: {},
  aliases: {},
  weekly_set_targets: {},
  created_at: new Date('2026-09-15T00:00:00Z'),
  updated_at: new Date('2026-09-15T00:00:00Z'),
};

/**
 * Every spelling the value could plausibly surface as: the column name, the
 * status token, the ester, and the dose. The dose is checked as a bare number
 * because that is what a careless `JSON.stringify(profile)` would emit.
 */
const FORBIDDEN = [
  'enhancement',
  'testosterone',
  'cypionate',
  'trt',
  '137',
] as const;

describe('the enhancement column never reaches the chat model', () => {
  it('is absent from the sparky_manage_coach_profile read', () => {
    const rendered = renderCoachProfile(row).toLowerCase();
    for (const term of FORBIDDEN) {
      expect(rendered).not.toContain(term);
    }
  });

  it('is absent from the coaching system prompt summary', () => {
    const summary = buildCoachProfileSummary(row).toLowerCase();
    for (const term of FORBIDDEN) {
      expect(summary).not.toContain(term);
    }
  });

  // The guarantee has to survive the column being populated *and* the rest of
  // the profile being empty, which is the shape that tempts a future author to
  // render the whole row for want of anything else to say.
  it('is absent even when nothing else is stated', () => {
    const sparse: CoachProfileRow = {
      ...row,
      goals: null,
      training_days_per_week: null,
      session_minutes: null,
      experience_level: null,
      equipment: [],
      limitations: [],
    };
    const rendered = renderCoachProfile(sparse).toLowerCase();
    const summary = buildCoachProfileSummary(sparse).toLowerCase();
    for (const term of FORBIDDEN) {
      expect(rendered).not.toContain(term);
      expect(summary).not.toContain(term);
    }
  });

  // The renderers still have to say the things they always said; a test that
  // only asserts absence would pass against a builder that returned ''.
  it('still renders the fields the coach is meant to see', () => {
    const rendered = renderCoachProfile(row);
    expect(rendered).toContain('4 days/week');
    expect(rendered).toContain('left shoulder');
    expect(buildCoachProfileSummary(row)).toContain('60 min sessions');
  });
});
