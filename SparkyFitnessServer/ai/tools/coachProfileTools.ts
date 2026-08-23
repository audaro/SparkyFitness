import { tool } from 'ai';
import { log } from '../../config/logging.js';
import coachProfileRepository from '../../models/coachProfileRepository.js';
import type {
  CoachProfilePatch,
  CoachProfileRow,
} from '../../models/coachProfileRepository.js';
import gymEquipmentProfileRepository from '../../models/gymEquipmentProfileRepository.js';
import type { GymEquipmentProfileRow } from '../../models/gymEquipmentProfileRepository.js';
import { invalidateChatContextInputs } from '../../services/chatContextCache.js';
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
  'set_active_gym_profile',
];

const PROFILE_FIELDS = [
  'goals',
  'training_days_per_week',
  'session_minutes',
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
  return profile.equipment.length
    ? profile.equipment.join(', ')
    : 'no equipment listed';
}

export function renderGymProfiles(profiles: GymEquipmentProfileRow[]): string {
  if (profiles.length === 0) {
    // Not an error: no profile means no equipment constraint at all, which is
    // the default every account starts in. Saying so stops the model from
    // reporting a missing feature.
    return 'No gym equipment profiles yet. Without one, every exercise in the catalog counts as available. The user can create profiles in the app under Workout Settings → Gym Profiles.';
  }
  let text = '# Gym Profiles\n\n';
  for (const profile of profiles) {
    text += `- **${profile.name}**${profile.is_active ? ' (active)' : ''} — ${describeGymProfile(
      profile
    )} — ID: ${profile.id}\n`;
  }
  return text.trimEnd();
}

export function buildCoachProfileTools(userId: string, tz: string) {
  return {
    sparky_manage_coach_profile: tool({
      description: `The user's persistent coaching context: goals, training availability, equipment, injuries/limitations, food preferences, and personal aliases ("my usual walk").

Actions:
- get_coach_profile() — read it before proposing programming; a missing profile means the user has not been interviewed yet
- update_coach_profile(goals?, training_days_per_week?, session_minutes?, equipment?, limitations?, food_preferences?, aliases?) — saves only the provided fields; list/object fields REPLACE the stored value, so send the full updated list when adding one item
- get_gym_profiles() — the user's named equipment sets ("Home", "Commercial gym") and which one is active; the active one is what constrains generated workouts
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
                return 'No coach profile yet. Interview the user conversationally (goals, training days per week, minutes per session, equipment, injuries/limitations, food preferences) before their first program, then save the answers with update_coach_profile.';
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
            case 'set_active_gym_profile': {
              if (!args.gym_profile_id && !args.gym_profile_name) {
                return ERRORS.MISSING_PARAMS([
                  'gym_profile_id or gym_profile_name',
                ]);
              }
              let profileId = args.gym_profile_id;
              if (!profileId && args.gym_profile_name) {
                // Resolve names here rather than making the model round-trip
                // through get_gym_profiles: "I'm at home today" names a
                // profile, and the ids are never in the conversation.
                const wanted = args.gym_profile_name.toLowerCase();
                const profiles =
                  await gymEquipmentProfileRepository.listGymProfiles(userId);
                const match =
                  profiles.find((p) => p.name.toLowerCase() === wanted) ??
                  profiles.find((p) => p.name.toLowerCase().includes(wanted));
                if (!match) {
                  return ERRORS.NOT_FOUND('Gym profile', args.gym_profile_name);
                }
                profileId = match.id;
              }
              const activated =
                await gymEquipmentProfileRepository.setActiveGymProfile(
                  userId,
                  profileId as string
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
          log('error', '[Coach Profile Tool] Error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
