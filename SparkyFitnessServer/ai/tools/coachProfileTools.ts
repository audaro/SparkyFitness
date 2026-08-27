import { tool } from 'ai';
import { log } from '../../config/logging.js';
import coachProfileRepository from '../../models/coachProfileRepository.js';
import type {
  CoachProfilePatch,
  CoachProfileRow,
} from '../../models/coachProfileRepository.js';
import gymEquipmentProfileRepository from '../../models/gymEquipmentProfileRepository.js';
import type {
  GymEquipmentProfilePatch,
  GymEquipmentProfileRow,
} from '../../models/gymEquipmentProfileRepository.js';
import { invalidateChatContextInputs } from '../../services/chatContextCache.js';
import { isDuplicateNameError } from '../../utils/errors.js';
import {
  EQUIPMENT,
  GYM_TEMPLATES,
  deriveApparatusFromItems,
  deriveEquipmentFromItems,
  type EquipmentItemSlug,
} from '@workspace/shared';
import { ERRORS, formatZodError } from './errors.js';
import { normalizeActionArgs } from './dates.js';
import { formatConfirmation } from './formatting.js';
import {
  manageCoachProfileSchema,
  manageCoachProfileInput,
  type ManageCoachProfileInput,
} from './schemas/coachProfile.js';

// Exported for the same sync pin as exerciseTools' VALID_ACTIONS.
export const VALID_ACTIONS = [
  'get_coach_profile',
  'update_coach_profile',
  'get_gym_profiles',
  'create_gym_profile',
  'update_gym_profile',
  'set_active_gym_profile',
];

const PROFILE_FIELDS = [
  'goals',
  'training_days_per_week',
  'session_minutes',
  'experience_level',
  'equipment',
  'limitations',
  'food_preferences',
  'aliases',
] as const;

export function renderCoachProfile(profile: CoachProfileRow): string {
  let text = '# Coach Profile\n\n';
  text += `- Goals: ${profile.goals ?? 'not set'}\n`;
  const days = profile.training_days_per_week;
  const minutes = profile.session_minutes;
  text += `- Training: ${days !== null ? `${days} days/week` : 'days not set'}, ${
    minutes !== null ? `${minutes} min sessions` : 'session length not set'
  }\n`;
  text += `- Experience: ${profile.experience_level ?? 'not set'}\n`;
  text += `- Equipment: ${
    profile.equipment.length ? profile.equipment.join(', ') : 'none listed'
  }\n`;
  text += `- Limitations: ${
    profile.limitations.length ? profile.limitations.join(', ') : 'none listed'
  }\n`;
  const prefs = Object.keys(profile.food_preferences);
  text += `- Food preferences: ${
    prefs.length ? JSON.stringify(profile.food_preferences) : 'none listed'
  }\n`;
  const aliasEntries = Object.entries(profile.aliases);
  if (aliasEntries.length) {
    text += '- Aliases:\n';
    for (const [phrase, target] of aliasEntries) {
      text += `  - "${phrase}" → ${target.kind} ${target.id}\n`;
    }
  } else {
    text += '- Aliases: none\n';
  }
  return text.trimEnd();
}

function describeGymProfile(profile: GymEquipmentProfileRow): string {
  // An item-stated profile is summarized as a count — confirmations must stay
  // one line, and forty item slugs are not one line. get_gym_profiles is the
  // read; the app's editor is where the full list lives.
  const parts = [
    Array.isArray(profile.equipment_items)
      ? `${profile.equipment_items.length} equipment item${
          profile.equipment_items.length === 1 ? '' : 's'
        }`
      : profile.equipment.length
        ? profile.equipment.join(', ')
        : 'no equipment listed',
  ];
  // Stated apparatus is authoritative (null means "unstated: inferred from
  // equipment"), so the model has to see it to reason about pull-ups/racks.
  if (profile.apparatus !== null) {
    parts.push(
      `apparatus: ${profile.apparatus.length ? profile.apparatus.join(', ') : 'none'}`
    );
  }
  const dumbbellMaxKg = profile.load_limits?.dumbbell?.max_kg;
  if (dumbbellMaxKg !== undefined) {
    parts.push(`dumbbells up to ${dumbbellMaxKg} kg`);
  }
  return parts.join('; ');
}

export function renderGymProfiles(profiles: GymEquipmentProfileRow[]): string {
  if (profiles.length === 0) {
    // Not an error: no profile means no equipment constraint at all, which is
    // the default every account starts in. Saying so stops the model from
    // reporting a missing feature.
    return 'No gym equipment profiles yet. Without one, every exercise in the catalog counts as available. Create one with create_gym_profile when the user describes their gym; the user can also manage profiles in the app on the Exercise tab under Setup → Gym profiles.';
  }
  let text = '# Gym Profiles\n\n';
  for (const profile of profiles) {
    text += `- **${profile.name}**${profile.is_active ? ' (active)' : ''} — ${describeGymProfile(
      profile
    )} — ID: ${profile.id}\n`;
  }
  return text.trimEnd();
}

/**
 * Resolves a gym-profile selector (id or name) to a profile id. Names resolve
 * here rather than making the model round-trip through get_gym_profiles:
 * "I'm at home today" names a profile, and the ids are never in the
 * conversation. A substring hit must be UNIQUE — "gym" against "Home Gym" and
 * "Commercial Gym" would otherwise silently pick whichever the repository
 * listed first, and the wrong profile then shapes every generated workout
 * without anything in the conversation showing that it happened.
 */
async function resolveGymProfileId(
  userId: string,
  selector: { gym_profile_id?: string; gym_profile_name?: string }
): Promise<{ profileId: string } | { error: string }> {
  if (selector.gym_profile_id) {
    return { profileId: selector.gym_profile_id };
  }
  if (!selector.gym_profile_name) {
    return {
      error: ERRORS.MISSING_PARAMS(['gym_profile_id or gym_profile_name']),
    };
  }
  const wanted = selector.gym_profile_name.toLowerCase();
  const profiles = await gymEquipmentProfileRepository.listGymProfiles(userId);
  const exact = profiles.filter((p) => p.name.toLowerCase() === wanted);
  const matches = exact.length
    ? exact
    : profiles.filter((p) => p.name.toLowerCase().includes(wanted));
  if (matches.length === 0) {
    return {
      error: ERRORS.NOT_FOUND('Gym profile', selector.gym_profile_name),
    };
  }
  if (matches.length > 1) {
    return {
      error: ERRORS.VALIDATION(
        `"${selector.gym_profile_name}" matches ${matches.length} gym profiles (${matches
          .map((p) => p.name)
          .join(
            ', '
          )}). Ask the user which one, then call again with that exact name or its ID.`
      ),
    };
  }
  return { profileId: matches[0].id };
}

export function buildCoachProfileTools(userId: string, tz: string) {
  return {
    sparky_manage_coach_profile: tool({
      description: `The user's persistent coaching context: goals, training availability, equipment, injuries/limitations, food preferences, and personal aliases ("my usual walk").

Actions:
- get_coach_profile() — read it before proposing programming; a missing profile means the user has not been interviewed yet
- update_coach_profile(goals?, training_days_per_week?, session_minutes?, experience_level?, equipment?, limitations?, food_preferences?, aliases?) — saves only the provided fields; list/object fields REPLACE the stored value, so send the full updated list when adding one item. experience_level is 'beginner' | 'intermediate' | 'expert' and biases which exercises generated workouts select
- get_gym_profiles() — the user's named equipment sets ("Home", "Commercial gym") and which one is active; the active one is what constrains generated workouts
- create_gym_profile(gym_profile_name, gym_template?|gym_equipment_items?|gym_equipment, gym_apparatus?, gym_dumbbell_max_kg?, make_active?) — save a named equipment set when the user describes a gym ("Planet Fitness has..."). Prefer the granular sources: gym_template names a known gym shape and expands server-side; gym_equipment_items states the exact machines and stations as slugs from the published enum. Either derives equipment and apparatus automatically, so never send gym_equipment or gym_apparatus alongside them. Fall back to coarse gym_equipment only when the details are unknown — it accepts the canonical catalog values (${EQUIPMENT.join(
        ', '
      )}); map real equipment to the closest value instead of inventing new ones. gym_apparatus (coarse mode only) states what bodyweight movements can hang from or brace against (pull-up bar, dip station, squat rack, bench) — an explicit list (empty included) is authoritative; omitted, it is inferred from the equipment. gym_dumbbell_max_kg is the heaviest dumbbell in kg per hand — prescriptions cap at it
- update_gym_profile(gym_profile_id?|gym_profile_name?, new_name?, gym_equipment_items?, gym_equipment?, gym_apparatus?, gym_dumbbell_max_kg?) — rename a profile or change its equipment/apparatus/dumbbell ceiling; gym_equipment_items, gym_equipment and gym_apparatus each REPLACE the stored list, so send the full updated list when adding one item. Rewriting gym_equipment or gym_apparatus on an item-stated profile drops its stored items
- set_active_gym_profile(gym_profile_name?|gym_profile_id?) — switch where the user is training today ("I'm at home"), then regenerate; only one profile is active at a time`,
      inputSchema: manageCoachProfileInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          tz,
          VALID_ACTIONS,
          (args) => {
            if (
              args.gym_profile_id !== undefined ||
              args.gym_profile_name !== undefined
            ) {
              return 'set_active_gym_profile';
            }
            return PROFILE_FIELDS.some((field) => args[field] !== undefined)
              ? 'update_coach_profile'
              : 'get_coach_profile';
          }
        );
        const parsed = manageCoachProfileSchema.safeParse(normalized);
        if (!parsed.success) return formatZodError(parsed.error);
        const args: ManageCoachProfileInput = parsed.data;
        try {
          switch (args.action) {
            case 'get_coach_profile': {
              const profile =
                await coachProfileRepository.getCoachProfile(userId);
              if (!profile) {
                return 'No coach profile yet. Interview the user conversationally (goals, training days per week, minutes per session, experience level, equipment, injuries/limitations, food preferences) before their first program, then save the answers with update_coach_profile.';
              }
              return renderCoachProfile(profile);
            }
            case 'update_coach_profile': {
              const patchFields = PROFILE_FIELDS.filter(
                (field) => args[field] !== undefined
              );
              if (patchFields.length === 0) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide at least one profile field.'
                );
              }
              const patch: Record<string, unknown> = {};
              for (const field of patchFields) {
                patch[field] = args[field];
              }
              await coachProfileRepository.upsertCoachProfile(
                userId,
                patch as CoachProfilePatch
              );
              // The system prompt embeds a summary of this profile via the
              // per-user chat-context cache; drop it so the next turn sees
              // the edit immediately instead of after the TTL.
              invalidateChatContextInputs(userId);
              return formatConfirmation(
                `Coach profile updated (${patchFields.join(', ')}).`
              );
            }
            case 'get_gym_profiles': {
              const profiles =
                await gymEquipmentProfileRepository.listGymProfiles(userId);
              return renderGymProfiles(profiles);
            }
            case 'create_gym_profile': {
              // Items may arrive directly or via a template name; either way
              // the coarse columns are derived from them — the same
              // derivation contract the REST route enforces, replicated here
              // because this tool writes through the repository.
              const items: EquipmentItemSlug[] | null =
                args.gym_template !== undefined
                  ? [...GYM_TEMPLATES[args.gym_template]]
                  : args.gym_equipment_items !== undefined
                    ? [...new Set(args.gym_equipment_items)]
                    : null;
              if (items === null && args.gym_equipment === undefined) {
                // Unreachable: the schema requires one of the three sources.
                return ERRORS.MISSING_PARAMS([
                  'gym_equipment, gym_equipment_items, or gym_template',
                ]);
              }
              const created =
                await gymEquipmentProfileRepository.createGymProfile(
                  userId,
                  items !== null
                    ? {
                        name: args.gym_profile_name,
                        equipment: deriveEquipmentFromItems(items),
                        apparatus: deriveApparatusFromItems(items),
                        equipment_items: items,
                        load_limits:
                          args.gym_dumbbell_max_kg !== undefined
                            ? { dumbbell: { max_kg: args.gym_dumbbell_max_kg } }
                            : undefined,
                        is_active: args.make_active === true,
                      }
                    : {
                        name: args.gym_profile_name,
                        // Duplicates are harmless to the jsonb filter but would
                        // render twice everywhere the list is shown.
                        equipment: [...new Set(args.gym_equipment ?? [])],
                        // Omitted stays undefined → stored SQL NULL
                        // ("unstated"); an explicit list ([] included) is
                        // stored as stated.
                        apparatus:
                          args.gym_apparatus !== undefined
                            ? [...new Set(args.gym_apparatus)]
                            : undefined,
                        load_limits:
                          args.gym_dumbbell_max_kg !== undefined
                            ? { dumbbell: { max_kg: args.gym_dumbbell_max_kg } }
                            : undefined,
                        is_active: args.make_active === true,
                      }
                );
              return formatConfirmation(
                created.is_active
                  ? `Created gym profile "${created.name}" (${describeGymProfile(
                      created
                    )}) and made it active. Generated workouts will only use this equipment — regenerate to apply it.`
                  : `Created gym profile "${created.name}" (${describeGymProfile(
                      created
                    )}). It is not active yet — set_active_gym_profile makes generated workouts use it.`
              );
            }
            case 'update_gym_profile': {
              if (
                args.new_name === undefined &&
                args.gym_equipment === undefined &&
                args.gym_apparatus === undefined &&
                args.gym_equipment_items === undefined &&
                args.gym_dumbbell_max_kg === undefined
              ) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide new_name, gym_equipment, gym_apparatus, gym_equipment_items, and/or gym_dumbbell_max_kg.'
                );
              }
              const resolved = await resolveGymProfileId(userId, args);
              if ('error' in resolved) return resolved.error;
              const patch: GymEquipmentProfilePatch = {};
              if (args.new_name !== undefined) patch.name = args.new_name;
              if (args.gym_equipment_items !== undefined) {
                // Same derivation contract as create: the coarse columns are
                // recomputed from the stated items.
                const items = [...new Set(args.gym_equipment_items)];
                patch.equipment_items = items;
                patch.equipment = deriveEquipmentFromItems(items);
                patch.apparatus = deriveApparatusFromItems(items);
              } else if (
                args.gym_equipment !== undefined ||
                args.gym_apparatus !== undefined
              ) {
                // A coarse rewrite of an item-stated profile drops it back to
                // coarse mode — stored items silently disagreeing with edited
                // coarse columns would be two sources of truth.
                patch.equipment_items = null;
              }
              if (args.gym_equipment !== undefined) {
                patch.equipment = [...new Set(args.gym_equipment)];
              }
              if (args.gym_apparatus !== undefined) {
                patch.apparatus = [...new Set(args.gym_apparatus)];
              }
              if (args.gym_dumbbell_max_kg !== undefined) {
                // load_limits replaces the whole column, and this tool edits
                // only the dumbbell ceiling — merge onto the row's current map
                // so other equipment limits (and a dumbbell increment
                // override) survive the edit.
                const current =
                  await gymEquipmentProfileRepository.getGymProfile(
                    userId,
                    resolved.profileId
                  );
                if (!current) {
                  return ERRORS.NOT_FOUND(
                    'Gym profile',
                    args.gym_profile_id ?? (args.gym_profile_name as string)
                  );
                }
                const existingLimits = current.load_limits ?? {};
                patch.load_limits = {
                  ...existingLimits,
                  dumbbell: {
                    ...existingLimits.dumbbell,
                    max_kg: args.gym_dumbbell_max_kg,
                  },
                };
              }
              const updated =
                await gymEquipmentProfileRepository.updateGymProfile(
                  userId,
                  resolved.profileId,
                  patch
                );
              if (!updated) {
                return ERRORS.NOT_FOUND(
                  'Gym profile',
                  args.gym_profile_id ?? (args.gym_profile_name as string)
                );
              }
              return formatConfirmation(
                `Gym profile "${updated.name}" updated (${describeGymProfile(
                  updated
                )}).${
                  updated.is_active
                    ? ' It is the active profile — regenerate workouts to apply the change.'
                    : ''
                }`
              );
            }
            case 'set_active_gym_profile': {
              const resolved = await resolveGymProfileId(userId, args);
              if ('error' in resolved) return resolved.error;
              const activated =
                await gymEquipmentProfileRepository.setActiveGymProfile(
                  userId,
                  resolved.profileId
                );
              if (!activated) {
                return ERRORS.NOT_FOUND(
                  'Gym profile',
                  args.gym_profile_id ?? (args.gym_profile_name as string)
                );
              }
              return formatConfirmation(
                `Active gym profile is now "${activated.name}" (${describeGymProfile(
                  activated
                )}). Generated workouts will only use this equipment — regenerate to apply it.`
              );
            }
            default:
              return ERRORS.INVALID_ACTION(
                (args as { action?: string }).action ?? 'unknown',
                VALID_ACTIONS
              );
          }
        } catch (error) {
          // Same 23505-on-name special case the REST routes make: a duplicate
          // profile name is a user-correctable conflict, not a DB failure.
          if (isDuplicateNameError(error)) {
            return ERRORS.VALIDATION(
              'A gym profile with this name already exists — pick a different name, or change the existing profile with update_gym_profile.'
            );
          }
          log('error', '[Coach Profile Tool] Error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
