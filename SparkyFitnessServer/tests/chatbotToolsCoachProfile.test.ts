import { vi, beforeEach, describe, expect, it } from 'vitest';
import { buildCoachProfileTools } from '../ai/tools/coachProfileTools.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import { invalidateChatContextInputs } from '../services/chatContextCache.js';

vi.mock('../models/coachProfileRepository', () => ({
  default: {
    getCoachProfile: vi.fn(),
    upsertCoachProfile: vi.fn(),
  },
}));
vi.mock('../services/chatContextCache', () => ({
  invalidateChatContextInputs: vi.fn(),
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };
const EXERCISE_ID = '55555555-5555-4555-8555-555555555555';

const fullProfile = {
  id: '66666666-6666-4666-8666-666666666666',
  user_id: 'user-1',
  goals: 'Lose 5 kg and run a 10k',
  training_days_per_week: 4,
  session_minutes: 60,
  equipment: ['dumbbells', 'resistance bands'],
  limitations: ['left knee pain'],
  food_preferences: { style: 'vegetarian' },
  aliases: {
    'my usual walk': { kind: 'exercise' as const, id: EXERCISE_ID },
  },
  created_at: new Date('2026-08-01T00:00:00Z'),
  updated_at: new Date('2026-08-01T00:00:00Z'),
};

let tools: ReturnType<typeof buildCoachProfileTools>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = buildCoachProfileTools('user-1', 'UTC');
});

describe('coach profile', () => {
  it('get_coach_profile tells the model to interview when no profile exists', async () => {
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(null);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_coach_profile' },
      opts
    );

    expect(result).toBe(
      'No coach profile yet. Interview the user conversationally (goals, training days per week, minutes per session, equipment, injuries/limitations, food preferences) before their first program, then save the answers with update_coach_profile.'
    );
  });

  it('get_coach_profile renders the stored profile', async () => {
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(
      fullProfile
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_coach_profile' },
      opts
    );

    expect(result).toBe(
      '# Coach Profile\n\n' +
        '- Goals: Lose 5 kg and run a 10k\n' +
        '- Training: 4 days/week, 60 min sessions\n' +
        '- Equipment: dumbbells, resistance bands\n' +
        '- Limitations: left knee pain\n' +
        '- Food preferences: {"style":"vegetarian"}\n' +
        '- Aliases:\n' +
        `  - "my usual walk" → exercise ${EXERCISE_ID}`
    );
  });

  it('update_coach_profile sends only the provided fields', async () => {
    vi.mocked(coachProfileRepository.upsertCoachProfile).mockResolvedValue(
      fullProfile
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_coach_profile',
        goals: 'Build strength',
        training_days_per_week: 3,
        equipment: ['barbell'],
      },
      opts
    );

    expect(result).toBe(
      '✅ Coach profile updated (goals, training_days_per_week, equipment).'
    );
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'user-1',
      {
        goals: 'Build strength',
        training_days_per_week: 3,
        equipment: ['barbell'],
      }
    );
    expect(invalidateChatContextInputs).toHaveBeenCalledWith('user-1');
  });

  it('accepts an integer id for a workout_preset alias', async () => {
    vi.mocked(coachProfileRepository.upsertCoachProfile).mockResolvedValue(
      fullProfile
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_coach_profile',
        aliases: { 'leg day': { kind: 'workout_preset', id: 12 } },
      },
      opts
    );

    expect(result).toBe('✅ Coach profile updated (aliases).');
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'user-1',
      { aliases: { 'leg day': { kind: 'workout_preset', id: 12 } } }
    );
  });

  it('infers update from profile fields and get from an empty call', async () => {
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(null);
    vi.mocked(coachProfileRepository.upsertCoachProfile).mockResolvedValue(
      fullProfile
    );

    await tools.sparky_manage_coach_profile.execute!(
      { limitations: ['shoulder impingement'] },
      opts
    );
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'user-1',
      { limitations: ['shoulder impingement'] }
    );

    await tools.sparky_manage_coach_profile.execute!({}, opts);
    expect(coachProfileRepository.getCoachProfile).toHaveBeenCalledTimes(1);
  });

  it('update_coach_profile rejects an empty patch', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'update_coach_profile' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update — provide at least one profile field.'
    );
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
    expect(invalidateChatContextInputs).not.toHaveBeenCalled();
  });

  it('rejects out-of-range training fields and bad alias targets', async () => {
    const badDays = await tools.sparky_manage_coach_profile.execute!(
      { action: 'update_coach_profile', training_days_per_week: 8 },
      opts
    );
    expect(badDays).toContain('Error [VALIDATION]');

    const badMinutes = await tools.sparky_manage_coach_profile.execute!(
      { action: 'update_coach_profile', session_minutes: 400 },
      opts
    );
    expect(badMinutes).toContain('Error [VALIDATION]');

    const badAlias = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_coach_profile',
        aliases: { 'my usual walk': { kind: 'exercise', id: 'not-a-uuid' } },
      },
      opts
    );
    expect(badAlias).toContain('Error [VALIDATION]');
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  it('rejects oversized alias maps and food_preferences payloads', async () => {
    const manyAliases: Record<string, { kind: 'exercise'; id: string }> = {};
    for (let i = 0; i < 51; i++) {
      manyAliases[`alias ${i}`] = { kind: 'exercise', id: EXERCISE_ID };
    }
    const tooManyAliases = await tools.sparky_manage_coach_profile.execute!(
      { action: 'update_coach_profile', aliases: manyAliases },
      opts
    );
    expect(tooManyAliases).toContain('Error [VALIDATION]');

    const hugePrefs = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_coach_profile',
        food_preferences: { notes: 'x'.repeat(2100) },
      },
      opts
    );
    expect(hugePrefs).toContain('Error [VALIDATION]');
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });
});
