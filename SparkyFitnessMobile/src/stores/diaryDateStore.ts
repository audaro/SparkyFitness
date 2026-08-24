import { createDateStore, type DateStoreState } from './createDateStore';

/**
 * Shared date for Home, Food, and the logging flows launched from them
 * (Log Food/Exercise/Workout/Activity, Add Measurements). The Exercise tab
 * keeps its own day in `exerciseDateStore`.
 */
export type DiaryDateState = DateStoreState;

export const useDiaryDateStore = createDateStore();
