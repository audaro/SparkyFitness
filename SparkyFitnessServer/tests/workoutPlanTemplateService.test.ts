import { beforeEach, describe, expect, it, vi } from 'vitest';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';
import exerciseRepository from '../models/exerciseRepository.js';

vi.mock('../models/workoutPlanTemplateRepository.js', () => ({
  default: {
    createWorkoutPlanTemplate: vi.fn(),
    getWorkoutPlanTemplatesByUserId: vi.fn(),
    getWorkoutPlanTemplateById: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
    deleteWorkoutPlanTemplate: vi.fn(),
    getWorkoutPlanTemplateOwnerId: vi.fn(),
    getActiveWorkoutPlanForDate: vi.fn(),
    unlinkExerciseEntriesByTemplateId: vi.fn(),
  },
}));

vi.mock('../models/workoutPresetRepository.js', () => ({
  default: {
    getWorkoutPresetById: vi.fn(),
  },
}));

vi.mock('../models/exerciseRepository.js', () => ({
  default: {
    getExerciseById: vi.fn(),
    createExerciseEntriesFromTemplate: vi.fn(),
    deleteExerciseEntriesByTemplateId: vi.fn(),
  },
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  resolveTemplateStartDay: vi.fn(async () => '2026-09-10'),
}));

const USER_ID = 'user-uuid-1234';
const OTHER_USER_ID = 'other-user-uuid-5678';
const TEMPLATE_ID = 9999;

describe('workoutPlanTemplateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWorkoutPlanTemplateById', () => {
    it('returns the template when found for the user', async () => {
      const mockTemplate = {
        id: TEMPLATE_ID,
        user_id: USER_ID,
        plan_name: 'Hypertrophy Block A',
        is_active: true,
        assignments: [],
      };
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateById
      ).mockResolvedValue(mockTemplate);

      const result =
        await workoutPlanTemplateService.getWorkoutPlanTemplateById(
          USER_ID,
          TEMPLATE_ID
        );

      expect(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateById
      ).toHaveBeenCalledWith(TEMPLATE_ID, USER_ID);
      expect(result).toEqual(mockTemplate);
    });

    it('throws "Workout plan template not found." when repository returns null', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateById
      ).mockResolvedValue(null);

      await expect(
        workoutPlanTemplateService.getWorkoutPlanTemplateById(
          USER_ID,
          TEMPLATE_ID
        )
      ).rejects.toThrow('Workout plan template not found.');
    });
  });

  describe('getWorkoutPlanTemplatesByUserId', () => {
    it('delegates to repository getWorkoutPlanTemplatesByUserId', async () => {
      const mockTemplates = [
        { id: 't1', plan_name: 'Plan 1' },
        { id: 't2', plan_name: 'Plan 2' },
      ];
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplatesByUserId
      ).mockResolvedValue(mockTemplates);

      const result =
        await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
          USER_ID
        );

      expect(
        workoutPlanTemplateRepository.getWorkoutPlanTemplatesByUserId
      ).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(mockTemplates);
    });
  });

  describe('updateWorkoutPlanTemplate', () => {
    it('throws Forbidden when user does not own the template', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(OTHER_USER_ID);

      await expect(
        workoutPlanTemplateService.updateWorkoutPlanTemplate(
          USER_ID,
          TEMPLATE_ID,
          { plan_name: 'Updated Name' }
        )
      ).rejects.toThrow(
        'Forbidden: You do not have permission to update this workout plan template.'
      );
    });

    it('updates template when user is owner', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(USER_ID);
      vi.mocked(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).mockResolvedValue({
        id: TEMPLATE_ID,
        plan_name: 'Updated Name',
        is_active: false,
      });

      const result = await workoutPlanTemplateService.updateWorkoutPlanTemplate(
        USER_ID,
        TEMPLATE_ID,
        { plan_name: 'Updated Name' }
      );

      expect(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).toHaveBeenCalledWith(TEMPLATE_ID, USER_ID);
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).toHaveBeenCalledWith(
        TEMPLATE_ID,
        USER_ID,
        {
          plan_name: 'Updated Name',
        },
        false
      );
      expect(result.plan_name).toBe('Updated Name');
    });
  });

  describe('deleteWorkoutPlanTemplate', () => {
    it('throws not found when owner ID is not found', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(null);

      await expect(
        workoutPlanTemplateService.deleteWorkoutPlanTemplate(
          USER_ID,
          TEMPLATE_ID
        )
      ).rejects.toThrow('Workout plan template not found.');
    });

    it('throws Forbidden when user does not own the template', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(OTHER_USER_ID);

      await expect(
        workoutPlanTemplateService.deleteWorkoutPlanTemplate(
          USER_ID,
          TEMPLATE_ID
        )
      ).rejects.toThrow(
        'Forbidden: You do not have permission to delete this workout plan template.'
      );
    });

    it('deletes template and cleans up entries when user is owner', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(USER_ID);
      vi.mocked(
        workoutPlanTemplateRepository.deleteWorkoutPlanTemplate
      ).mockResolvedValue({ id: TEMPLATE_ID });

      const result = await workoutPlanTemplateService.deleteWorkoutPlanTemplate(
        USER_ID,
        TEMPLATE_ID
      );

      expect(
        exerciseRepository.deleteExerciseEntriesByTemplateId
      ).toHaveBeenCalledWith(TEMPLATE_ID, USER_ID, '2026-09-10');
      expect(
        workoutPlanTemplateRepository.deleteWorkoutPlanTemplate
      ).toHaveBeenCalledWith(TEMPLATE_ID, USER_ID);
      expect(result).toEqual({
        message: 'Workout plan template deleted successfully.',
      });
    });
  });

  describe('createWorkoutPlanTemplate', () => {
    it('creates active weekly plan with entry_mode prefill and materializes entries', async () => {
      const mockCreated = {
        id: TEMPLATE_ID,
        user_id: USER_ID,
        plan_name: 'Weekly Plan',
        is_active: true,
        schedule_type: 'weekly' as const,
        entry_mode: 'prefill' as const,
      };
      vi.mocked(
        workoutPlanTemplateRepository.createWorkoutPlanTemplate
      ).mockResolvedValue(mockCreated);

      const result = await workoutPlanTemplateService.createWorkoutPlanTemplate(
        USER_ID,
        {
          plan_name: 'Weekly Plan',
          is_active: true,
          schedule_type: 'weekly',
          entry_mode: 'prefill',
          assignments: [{ day_of_week: 1, sort_order: 0 }],
        }
      );

      expect(result).toEqual(mockCreated);
      expect(
        exerciseRepository.createExerciseEntriesFromTemplate
      ).toHaveBeenCalledWith(TEMPLATE_ID, USER_ID, '2026-09-10');
    });

    it('creates active weekly plan with entry_mode prompt and does NOT materialize entries', async () => {
      const mockCreated = {
        id: TEMPLATE_ID,
        user_id: USER_ID,
        plan_name: 'Weekly Plan Prompt Only',
        is_active: true,
        schedule_type: 'weekly' as const,
        entry_mode: 'prompt' as const,
      };
      vi.mocked(
        workoutPlanTemplateRepository.createWorkoutPlanTemplate
      ).mockResolvedValue(mockCreated);

      const result = await workoutPlanTemplateService.createWorkoutPlanTemplate(
        USER_ID,
        {
          plan_name: 'Weekly Plan Prompt Only',
          is_active: true,
          schedule_type: 'weekly',
          entry_mode: 'prompt',
          assignments: [{ day_of_week: 1, sort_order: 0 }],
        }
      );

      expect(result).toEqual(mockCreated);
      expect(
        exerciseRepository.createExerciseEntriesFromTemplate
      ).not.toHaveBeenCalled();
    });

    it('creates active sequential plan and does NOT materialize entries', async () => {
      const mockCreated = {
        id: TEMPLATE_ID,
        user_id: USER_ID,
        plan_name: 'Sequential Plan',
        is_active: true,
        schedule_type: 'sequential' as const,
        entry_mode: 'prompt' as const,
      };
      vi.mocked(
        workoutPlanTemplateRepository.createWorkoutPlanTemplate
      ).mockResolvedValue(mockCreated);

      const result = await workoutPlanTemplateService.createWorkoutPlanTemplate(
        USER_ID,
        {
          plan_name: 'Sequential Plan',
          is_active: true,
          schedule_type: 'sequential',
          assignments: [{ day_of_week: null, sort_order: 0 }],
        }
      );

      expect(result).toEqual(mockCreated);
      expect(
        exerciseRepository.createExerciseEntriesFromTemplate
      ).not.toHaveBeenCalled();
    });

    it('throws error when weekly plan has invalid day_of_week', async () => {
      await expect(
        workoutPlanTemplateService.createWorkoutPlanTemplate(USER_ID, {
          plan_name: 'Invalid Weekly Plan',
          is_active: true,
          schedule_type: 'weekly',
          assignments: [
            { day_of_week: null as unknown as number, sort_order: 0 },
          ],
        })
      ).rejects.toThrow(
        'Weekly workout plan assignments must have a valid day_of_week (0-6).'
      );
    });
  });

  describe('updateWorkoutPlanTemplate - sequential vs weekly', () => {
    it('throws error when changing schedule_type without providing assignments', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(USER_ID);
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateById
      ).mockResolvedValue({
        id: TEMPLATE_ID,
        user_id: USER_ID,
        plan_name: 'Existing Weekly',
        is_active: true,
        schedule_type: 'weekly',
        assignments: [],
      });

      await expect(
        workoutPlanTemplateService.updateWorkoutPlanTemplate(
          USER_ID,
          TEMPLATE_ID,
          {
            plan_name: 'Switched to Sequential',
            schedule_type: 'sequential',
          }
        )
      ).rejects.toThrow(
        'Changing schedule_type requires providing updated assignments.'
      );
    });

    it('switching weekly to sequential with assignments deletes old entries and skips materialization', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(USER_ID);
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateById
      ).mockResolvedValue({
        id: TEMPLATE_ID,
        user_id: USER_ID,
        plan_name: 'Existing Weekly',
        is_active: true,
        schedule_type: 'weekly',
        assignments: [],
      });
      vi.mocked(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).mockResolvedValue({
        id: TEMPLATE_ID,
        plan_name: 'Switched to Sequential',
        is_active: true,
        schedule_type: 'sequential',
      });

      const result = await workoutPlanTemplateService.updateWorkoutPlanTemplate(
        USER_ID,
        TEMPLATE_ID,
        {
          plan_name: 'Switched to Sequential',
          is_active: true,
          schedule_type: 'sequential',
          assignments: [{ session_index: 0, sort_order: 0 }],
        }
      );

      expect(
        exerciseRepository.deleteExerciseEntriesByTemplateId
      ).toHaveBeenCalledWith(TEMPLATE_ID, USER_ID, '2026-09-10');
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).toHaveBeenCalledWith(
        TEMPLATE_ID,
        USER_ID,
        {
          plan_name: 'Switched to Sequential',
          is_active: true,
          schedule_type: 'sequential',
          assignments: [{ session_index: 0, sort_order: 0, day_of_week: null }],
        },
        true
      );
      expect(
        exerciseRepository.createExerciseEntriesFromTemplate
      ).not.toHaveBeenCalled();
      expect(result.schedule_type).toBe('sequential');
    });

    it('throws error when updating weekly plan with invalid day_of_week', async () => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(USER_ID);

      await expect(
        workoutPlanTemplateService.updateWorkoutPlanTemplate(
          USER_ID,
          TEMPLATE_ID,
          {
            schedule_type: 'weekly',
            assignments: [{ day_of_week: 7, sort_order: 0 }],
          }
        )
      ).rejects.toThrow(
        'Weekly workout plan assignments must have a valid day_of_week (0-6).'
      );
    });
  });

  describe('getActiveWorkoutPlanForDate', () => {
    it('delegates to repository getActiveWorkoutPlanForDate', async () => {
      const mockActive = [
        {
          id: TEMPLATE_ID,
          user_id: USER_ID,
          schedule_type: 'sequential' as const,
          next_assignment: { id: 1, sort_order: 0 },
          sequence_position: { current: 1, total: 3 },
        },
      ];
      vi.mocked(
        workoutPlanTemplateRepository.getActiveWorkoutPlanForDate
      ).mockResolvedValue(mockActive);

      const result =
        await workoutPlanTemplateService.getActiveWorkoutPlanForDate(
          USER_ID,
          '2026-09-21'
        );

      expect(
        workoutPlanTemplateRepository.getActiveWorkoutPlanForDate
      ).toHaveBeenCalledWith(USER_ID, '2026-09-21');
      expect(result).toEqual(mockActive);
    });
  });
});
