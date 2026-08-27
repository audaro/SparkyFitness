import { vi, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCoachProfileTools,
  VALID_ACTIONS,
} from '../ai/tools/coachProfileTools.js';
import {
  manageCoachProfileInput,
  manageCoachProfileSchema,
} from '../ai/tools/schemas/coachProfile.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import gymEquipmentProfileRepository from '../models/gymEquipmentProfileRepository.js';
import type { GymEquipmentProfileRow } from '../models/gymEquipmentProfileRepository.js';
import { invalidateChatContextInputs } from '../services/chatContextCache.js';

vi.mock('../models/coachProfileRepository', () => ({
  default: {
    getCoachProfile: vi.fn(),
    upsertCoachProfile: vi.fn(),
  },
}));
vi.mock('../models/gymEquipmentProfileRepository', () => ({
  default: {
    listGymProfiles: vi.fn(),
    getGymProfile: vi.fn(),
    setActiveGymProfile: vi.fn(),
    createGymProfile: vi.fn(),
    updateGymProfile: vi.fn(),
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
  experience_level: null,
  equipment: ['dumbbells', 'resistance bands'],
  limitations: ['left knee pain'],
  food_preferences: { style: 'vegetarian' },
  aliases: {
    'my usual walk': { kind: 'exercise' as const, id: EXERCISE_ID },
  },
  weekly_set_targets: {},
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
      'No coach profile yet. Interview the user conversationally (goals, training days per week, minutes per session, experience level, equipment, injuries/limitations, food preferences) before their first program, then save the answers with update_coach_profile.'
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
        '- Experience: not set\n' +
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

  it('saves and renders the experience level', async () => {
    vi.mocked(coachProfileRepository.upsertCoachProfile).mockResolvedValue({
      ...fullProfile,
      experience_level: 'beginner',
    });
    const updated = await tools.sparky_manage_coach_profile.execute!(
      { action: 'update_coach_profile', experience_level: 'beginner' },
      opts
    );
    expect(updated).toBe('✅ Coach profile updated (experience_level).');
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'user-1',
      { experience_level: 'beginner' }
    );

    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      ...fullProfile,
      experience_level: 'beginner',
    });
    const rendered = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_coach_profile' },
      opts
    );
    expect(rendered).toContain('- Experience: beginner\n');
  });

  // The generator's level term is an exact string match against
  // exercises.level, so the schema must refuse synonyms rather than store one
  // that would silently match nothing.
  it('rejects an experience level outside the vocabulary', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      // Out of vocabulary on purpose, so past the compile-time type.
      { action: 'update_coach_profile', experience_level: 'advanced' } as never,
      opts
    );
    expect(String(result)).toContain('experience_level');
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// W7.3 — gym profiles, so "I'm at home today" works conversationally
// ---------------------------------------------------------------------------

const HOME_ID = '77777777-7777-4777-8777-777777777777';
const GYM_ID = '88888888-8888-4888-8888-888888888888';

const homeProfile: GymEquipmentProfileRow = {
  id: HOME_ID,
  user_id: 'user-1',
  name: 'Home',
  equipment: ['dumbbell', 'bands'],
  apparatus: null,
  equipment_items: null,
  load_limits: null,
  is_active: false,
  created_at: new Date('2026-08-01T00:00:00Z'),
  updated_at: new Date('2026-08-01T00:00:00Z'),
};
const gymProfile: GymEquipmentProfileRow = {
  ...homeProfile,
  id: GYM_ID,
  name: 'Commercial Gym',
  equipment: ['barbell', 'cable'],
  is_active: true,
};

describe('gym profiles', () => {
  it('lists the profiles and marks the active one', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
      gymProfile,
    ]);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_gym_profiles' },
      opts
    );

    expect(result).toBe(
      '# Gym Profiles\n\n' +
        `- **Home** — dumbbell, bands — ID: ${HOME_ID}\n` +
        `- **Commercial Gym** (active) — barbell, cable — ID: ${GYM_ID}`
    );
  });

  // No profile is the default state, not a missing feature — the model has to
  // be told that, or it reports the app as broken.
  it('explains that no profile means no equipment constraint', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue(
      []
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_gym_profiles' },
      opts
    );

    expect(result).toBe(
      'No gym equipment profiles yet. Without one, every exercise in the catalog counts as available. Create one with create_gym_profile when the user describes their gym; the user can also manage profiles in the app on the Exercise tab under Setup → Gym profiles.'
    );
  });

  it('activates a profile by name, case-insensitively', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
      gymProfile,
    ]);
    vi.mocked(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).mockResolvedValue({ ...homeProfile, is_active: true });

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile', gym_profile_name: 'home' },
      opts
    );

    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).toHaveBeenCalledWith('user-1', HOME_ID);
    expect(result).toBe(
      '✅ Active gym profile is now "Home" (dumbbell, bands). Generated workouts will only use this equipment — regenerate to apply it.'
    );
  });

  it('activates a profile by id without listing first', async () => {
    vi.mocked(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).mockResolvedValue(gymProfile);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile', gym_profile_id: GYM_ID },
      opts
    );

    expect(
      gymEquipmentProfileRepository.listGymProfiles
    ).not.toHaveBeenCalled();
    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).toHaveBeenCalledWith('user-1', GYM_ID);
    expect(result).toContain('"Commercial Gym" (barbell, cable)');
  });

  it('infers the action from a bare profile name', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
    ]);
    vi.mocked(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).mockResolvedValue({ ...homeProfile, is_active: true });

    await tools.sparky_manage_coach_profile.execute!(
      { gym_profile_name: 'Home' },
      opts
    );

    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).toHaveBeenCalledWith('user-1', HOME_ID);
  });

  // Picking the first of several substring hits would activate a gym the user
  // never named, and the wrong equipment then shapes every generated workout
  // with nothing in the conversation showing that it happened.
  it('refuses an ambiguous name instead of guessing', async () => {
    const homeGym: GymEquipmentProfileRow = {
      ...homeProfile,
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Home Gym',
    };
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeGym,
      gymProfile,
    ]);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile', gym_profile_name: 'gym' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: "gym" matches 2 gym profiles (Home Gym, Commercial Gym). Ask the user which one, then call again with that exact name or its ID.'
    );
    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).not.toHaveBeenCalled();
  });

  it('takes an exact name over an ambiguous substring', async () => {
    const homeGym: GymEquipmentProfileRow = {
      ...homeProfile,
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Home Gym',
    };
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeGym,
      homeProfile,
    ]);
    vi.mocked(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).mockResolvedValue({ ...homeProfile, is_active: true });

    await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile', gym_profile_name: 'Home' },
      opts
    );

    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).toHaveBeenCalledWith('user-1', HOME_ID);
  });

  it('maps an unknown profile name to NOT_FOUND without writing', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
    ]);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile', gym_profile_name: 'Garage' },
      opts
    );

    expect(result).toBe(
      "Error [NOT_FOUND]: Gym profile with ID 'Garage' not found.\n\nSuggestion: Check the ID and try again."
    );
    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).not.toHaveBeenCalled();
  });

  // The repository returns null when the row is not the caller's; it is the
  // only signal that a syntactically valid uuid names someone else's profile.
  it('maps a foreign or stale uuid to NOT_FOUND', async () => {
    vi.mocked(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).mockResolvedValue(null);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile', gym_profile_id: GYM_ID },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Gym profile with ID '${GYM_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('asks for a selector when given neither', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'set_active_gym_profile' },
      opts
    );

    expect(result).toBe(
      'Error [MISSING_PARAMS]: Missing required parameters: gym_profile_id or gym_profile_name\n\nSuggestion: Provide all required parameters and try again.'
    );
    expect(
      gymEquipmentProfileRepository.setActiveGymProfile
    ).not.toHaveBeenCalled();
  });

  // Equipment must land as the canonical lowercase catalog vocabulary — the
  // generator filter is `equipment::jsonb ?|`, exact and case-sensitive, so a
  // profile stored with "Machine" or "treadmill" would silently match nothing.
  it('creates a profile with canonical, deduped, lowercased equipment', async () => {
    vi.mocked(gymEquipmentProfileRepository.createGymProfile).mockResolvedValue(
      {
        ...homeProfile,
        name: 'Planet Fitness',
        equipment: ['machine', 'dumbbell', 'cable'],
      }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Planet Fitness',
        gym_equipment: ['Machine', 'dumbbell', 'cable', 'machine'],
      } as never,
      opts
    );

    expect(gymEquipmentProfileRepository.createGymProfile).toHaveBeenCalledWith(
      'user-1',
      {
        name: 'Planet Fitness',
        equipment: ['machine', 'dumbbell', 'cable'],
        is_active: false,
      }
    );
    expect(result).toBe(
      '✅ Created gym profile "Planet Fitness" (machine, dumbbell, cable). It is not active yet — set_active_gym_profile makes generated workouts use it.'
    );
  });

  it('creates an active profile when asked and says regenerate', async () => {
    vi.mocked(gymEquipmentProfileRepository.createGymProfile).mockResolvedValue(
      { ...homeProfile, is_active: true }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Home',
        gym_equipment: ['dumbbell', 'bands'],
        make_active: true,
      },
      opts
    );

    expect(gymEquipmentProfileRepository.createGymProfile).toHaveBeenCalledWith(
      'user-1',
      { name: 'Home', equipment: ['dumbbell', 'bands'], is_active: true }
    );
    expect(result).toBe(
      '✅ Created gym profile "Home" (dumbbell, bands) and made it active. Generated workouts will only use this equipment — regenerate to apply it.'
    );
  });

  it('creates an item-stated profile, deriving the coarse columns', async () => {
    vi.mocked(gymEquipmentProfileRepository.createGymProfile).mockResolvedValue(
      {
        ...homeProfile,
        name: 'Hotel',
        equipment: ['cable', 'dumbbell', 'machine'],
        apparatus: [],
        equipment_items: ['smith-machine', 'lat-pulldown', 'dumbbells'],
      }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Hotel',
        // Title case and a duplicate: slugs lowercase-trim and dedupe like
        // the coarse equipment values do.
        gym_equipment_items: [
          'Smith-Machine',
          'smith-machine',
          'lat-pulldown',
          'dumbbells',
        ],
      } as never,
      opts
    );

    // The coarse columns are derived from the items (no bench item → stated
    // apparatus []), same contract as the REST route.
    expect(gymEquipmentProfileRepository.createGymProfile).toHaveBeenCalledWith(
      'user-1',
      {
        name: 'Hotel',
        equipment: ['cable', 'dumbbell', 'machine'],
        apparatus: [],
        equipment_items: ['smith-machine', 'lat-pulldown', 'dumbbells'],
        is_active: false,
      }
    );
    // Confirmations stay one line: an item-stated profile reads as a count,
    // with the derived apparatus statement alongside.
    expect(result).toBe(
      '✅ Created gym profile "Hotel" (3 equipment items; apparatus: none). It is not active yet — set_active_gym_profile makes generated workouts use it.'
    );
  });

  it('expands a template name into items server-side', async () => {
    vi.mocked(
      gymEquipmentProfileRepository.createGymProfile
    ).mockImplementation(async (_userId, create) => ({
      ...homeProfile,
      name: create.name,
      equipment: [...create.equipment],
      apparatus: create.apparatus ? [...create.apparatus] : null,
      equipment_items: create.equipment_items
        ? [...create.equipment_items]
        : null,
      load_limits: create.load_limits ?? null,
      is_active: create.is_active === true,
    }));

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'PF Downtown',
        // What the user actually says — normalized to the slug server-side.
        gym_template: 'Planet Fitness',
        gym_dumbbell_max_kg: 22.5,
        make_active: true,
      } as never,
      opts
    );

    const create = vi.mocked(gymEquipmentProfileRepository.createGymProfile)
      .mock.calls[0][1];
    // The template's honesty pins: Smith machines and fixed barbells, never a
    // free Olympic bar.
    expect(create.equipment_items).toContain('smith-machine');
    expect(create.equipment_items).toContain('fixed-barbells');
    expect(create.equipment_items).not.toContain('barbell');
    expect(create.apparatus).toEqual(['bench']);
    expect(create.load_limits).toEqual({ dumbbell: { max_kg: 22.5 } });
    expect(result).toBe(
      '✅ Created gym profile "PF Downtown" (35 equipment items; apparatus: bench; dumbbells up to 22.5 kg) and made it active. Generated workouts will only use this equipment — regenerate to apply it.'
    );
  });

  it('rejects an item-stated create that also carries coarse fields', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Hotel',
        gym_equipment_items: ['dumbbells'],
        gym_equipment: ['dumbbell'],
      } as never,
      opts
    );

    expect(String(result)).toContain(
      'gym_equipment and gym_apparatus are derived from the stated items'
    );
    expect(
      gymEquipmentProfileRepository.createGymProfile
    ).not.toHaveBeenCalled();
  });

  it('rejects a template combined with an explicit item list', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Hotel',
        gym_template: 'hotel gym',
        gym_equipment_items: ['dumbbells'],
      } as never,
      opts
    );

    expect(String(result)).toContain(
      'Send gym_template or gym_equipment_items, not both'
    );
    expect(
      gymEquipmentProfileRepository.createGymProfile
    ).not.toHaveBeenCalled();
  });

  it('replaces the stored items on update and re-derives the coarse columns', async () => {
    vi.mocked(gymEquipmentProfileRepository.updateGymProfile).mockResolvedValue(
      {
        ...homeProfile,
        equipment: ['cable', 'dumbbell', 'machine'],
        apparatus: [],
        equipment_items: ['smith-machine', 'lat-pulldown', 'dumbbells'],
      }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_gym_profile',
        gym_profile_id: HOME_ID,
        gym_equipment_items: ['smith-machine', 'lat-pulldown', 'dumbbells'],
      } as never,
      opts
    );

    expect(gymEquipmentProfileRepository.updateGymProfile).toHaveBeenCalledWith(
      'user-1',
      HOME_ID,
      {
        equipment_items: ['smith-machine', 'lat-pulldown', 'dumbbells'],
        equipment: ['cable', 'dumbbell', 'machine'],
        apparatus: [],
      }
    );
    expect(result).toBe(
      '✅ Gym profile "Home" updated (3 equipment items; apparatus: none).'
    );
  });

  it('lists an item-stated profile as a count, not the item list', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      {
        ...gymProfile,
        equipment: ['machine', 'cable', 'dumbbell'],
        apparatus: ['bench'],
        equipment_items: [
          'smith-machine',
          'lat-pulldown',
          'dumbbells',
          'flat-bench',
        ],
      },
    ]);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_gym_profiles' },
      opts
    );

    expect(result).toBe(
      '# Gym Profiles\n\n' +
        `- **Commercial Gym** (active) — 4 equipment items; apparatus: bench — ID: ${GYM_ID}`
    );
  });

  it('lists stated apparatus and dumbbell ceilings, and says nothing for unstated ones', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      // homeProfile keeps apparatus/load_limits null: its row must not change.
      homeProfile,
      {
        ...gymProfile,
        name: 'Planet Fitness',
        equipment: ['machine', 'dumbbell'],
        apparatus: ['bench'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
      },
    ]);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_gym_profiles' },
      opts
    );

    expect(result).toBe(
      '# Gym Profiles\n\n' +
        `- **Home** — dumbbell, bands — ID: ${HOME_ID}\n` +
        `- **Planet Fitness** (active) — machine, dumbbell; apparatus: bench; dumbbells up to 22.5 kg — ID: ${GYM_ID}`
    );
  });

  it('renders a stated-empty apparatus list as "none", not as unstated', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      { ...homeProfile, apparatus: [] },
    ]);

    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'get_gym_profiles' },
      opts
    );

    expect(result).toBe(
      '# Gym Profiles\n\n' +
        `- **Home** — dumbbell, bands; apparatus: none — ID: ${HOME_ID}`
    );
  });

  it('creates a profile with stated apparatus and a dumbbell ceiling', async () => {
    vi.mocked(gymEquipmentProfileRepository.createGymProfile).mockResolvedValue(
      {
        ...homeProfile,
        name: 'Planet Fitness',
        equipment: ['machine', 'dumbbell', 'cable'],
        apparatus: ['bench'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
      }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Planet Fitness',
        gym_equipment: ['machine', 'dumbbell', 'cable'],
        // Title case and duplicates are the model mistakes the preprocess
        // forgives, same as gym_equipment.
        gym_apparatus: ['Bench', 'bench'],
        gym_dumbbell_max_kg: 22.5,
      } as never,
      opts
    );

    expect(gymEquipmentProfileRepository.createGymProfile).toHaveBeenCalledWith(
      'user-1',
      {
        name: 'Planet Fitness',
        equipment: ['machine', 'dumbbell', 'cable'],
        apparatus: ['bench'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
        is_active: false,
      }
    );
    expect(result).toBe(
      '✅ Created gym profile "Planet Fitness" (machine, dumbbell, cable; apparatus: bench; dumbbells up to 22.5 kg). It is not active yet — set_active_gym_profile makes generated workouts use it.'
    );
  });

  it('rejects apparatus outside the vocabulary without writing', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Planet Fitness',
        gym_equipment: ['machine'],
        gym_apparatus: ['smith machine'],
      } as never,
      opts
    );

    expect(String(result)).toContain('Error [VALIDATION]');
    expect(String(result)).toContain('gym_apparatus');
    expect(
      gymEquipmentProfileRepository.createGymProfile
    ).not.toHaveBeenCalled();
  });

  it('updates apparatus to a stated-empty list without touching load limits', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
      gymProfile,
    ]);
    vi.mocked(gymEquipmentProfileRepository.updateGymProfile).mockResolvedValue(
      { ...homeProfile, apparatus: [] }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_gym_profile',
        gym_profile_name: 'Home',
        gym_apparatus: [],
      } as never,
      opts
    );

    // No dumbbell ceiling in the patch, so the row is never re-read. The
    // coarse rewrite drops any stored items (null here since Home has none).
    expect(gymEquipmentProfileRepository.getGymProfile).not.toHaveBeenCalled();
    expect(gymEquipmentProfileRepository.updateGymProfile).toHaveBeenCalledWith(
      'user-1',
      HOME_ID,
      { apparatus: [], equipment_items: null }
    );
    expect(result).toBe(
      '✅ Gym profile "Home" updated (dumbbell, bands; apparatus: none).'
    );
  });

  it('merges a dumbbell ceiling into the profile’s existing load limits', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
      gymProfile,
    ]);
    vi.mocked(gymEquipmentProfileRepository.getGymProfile).mockResolvedValue({
      ...homeProfile,
      load_limits: {
        barbell: { max_kg: 60 },
        dumbbell: { max_kg: 20, increment_kg: 2 },
      },
    });
    vi.mocked(gymEquipmentProfileRepository.updateGymProfile).mockResolvedValue(
      {
        ...homeProfile,
        load_limits: {
          barbell: { max_kg: 60 },
          dumbbell: { max_kg: 24, increment_kg: 2 },
        },
      }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_gym_profile',
        gym_profile_name: 'Home',
        gym_dumbbell_max_kg: 24,
      } as never,
      opts
    );

    // The whole column is replaced, so the barbell entry and the dumbbell
    // increment override must ride along unchanged.
    expect(gymEquipmentProfileRepository.updateGymProfile).toHaveBeenCalledWith(
      'user-1',
      HOME_ID,
      {
        load_limits: {
          barbell: { max_kg: 60 },
          dumbbell: { max_kg: 24, increment_kg: 2 },
        },
      }
    );
    expect(result).toBe(
      '✅ Gym profile "Home" updated (dumbbell, bands; dumbbells up to 24 kg).'
    );
  });

  it('rejects equipment outside the canonical vocabulary without writing', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Planet Fitness',
        // Real machines have to be mapped to the enum, not passed through.
        gym_equipment: ['treadmill', 'machine'],
      } as never,
      opts
    );

    expect(String(result)).toContain('Error [VALIDATION]');
    expect(String(result)).toContain('gym_equipment');
    expect(
      gymEquipmentProfileRepository.createGymProfile
    ).not.toHaveBeenCalled();
  });

  it('rejects a create with no name or an empty equipment list', async () => {
    const noName = await tools.sparky_manage_coach_profile.execute!(
      { action: 'create_gym_profile', gym_equipment: ['dumbbell'] },
      opts
    );
    expect(String(noName)).toContain('Error [VALIDATION]');
    expect(String(noName)).toContain('gym_profile_name');

    const noEquipment = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Home',
        gym_equipment: [],
      },
      opts
    );
    expect(String(noEquipment)).toContain('Error [VALIDATION]');
    expect(
      gymEquipmentProfileRepository.createGymProfile
    ).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate profile name as a correctable conflict', async () => {
    vi.mocked(gymEquipmentProfileRepository.createGymProfile).mockRejectedValue(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'gym_equipment_profiles_user_id_name_key',
      })
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'create_gym_profile',
        gym_profile_name: 'Home',
        gym_equipment: ['dumbbell'],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: A gym profile with this name already exists — pick a different name, or change the existing profile with update_gym_profile.'
    );
  });

  it('updates a profile by name and flags the active one for regeneration', async () => {
    vi.mocked(gymEquipmentProfileRepository.listGymProfiles).mockResolvedValue([
      homeProfile,
      gymProfile,
    ]);
    vi.mocked(gymEquipmentProfileRepository.updateGymProfile).mockResolvedValue(
      { ...gymProfile, equipment: ['barbell', 'cable', 'machine'] }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_gym_profile',
        gym_profile_name: 'commercial gym',
        gym_equipment: ['barbell', 'cable', 'machine'],
      },
      opts
    );

    // Rewriting coarse equipment drops the profile back to coarse mode —
    // stored items may not silently disagree with the edited columns.
    expect(gymEquipmentProfileRepository.updateGymProfile).toHaveBeenCalledWith(
      'user-1',
      GYM_ID,
      { equipment: ['barbell', 'cable', 'machine'], equipment_items: null }
    );
    expect(result).toBe(
      '✅ Gym profile "Commercial Gym" updated (barbell, cable, machine). It is the active profile — regenerate workouts to apply the change.'
    );
  });

  it('renames a profile by id without listing first', async () => {
    vi.mocked(gymEquipmentProfileRepository.updateGymProfile).mockResolvedValue(
      { ...homeProfile, name: 'Garage' }
    );

    const result = await tools.sparky_manage_coach_profile.execute!(
      {
        action: 'update_gym_profile',
        gym_profile_id: HOME_ID,
        new_name: 'Garage',
      },
      opts
    );

    expect(
      gymEquipmentProfileRepository.listGymProfiles
    ).not.toHaveBeenCalled();
    expect(gymEquipmentProfileRepository.updateGymProfile).toHaveBeenCalledWith(
      'user-1',
      HOME_ID,
      { name: 'Garage' }
    );
    expect(result).toBe('✅ Gym profile "Garage" updated (dumbbell, bands).');
  });

  it('update_gym_profile rejects an empty patch before resolving', async () => {
    const result = await tools.sparky_manage_coach_profile.execute!(
      { action: 'update_gym_profile', gym_profile_name: 'Home' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update — provide new_name, gym_equipment, gym_apparatus, gym_equipment_items, and/or gym_dumbbell_max_kg.'
    );
    expect(
      gymEquipmentProfileRepository.listGymProfiles
    ).not.toHaveBeenCalled();
    expect(
      gymEquipmentProfileRepository.updateGymProfile
    ).not.toHaveBeenCalled();
  });

  it('keeps VALID_ACTIONS, the published enum and the strict union in sync', () => {
    const published = manageCoachProfileInput.shape.action.unwrap().options;
    const union = manageCoachProfileSchema.options.map(
      (option) => (option.shape.action as { value: string }).value
    );

    expect(VALID_ACTIONS).toEqual(published);
    expect(VALID_ACTIONS).toEqual(union);
  });
});
