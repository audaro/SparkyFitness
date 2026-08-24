import { create } from 'zustand';
import { addDays, getTodayDate } from '../utils/dateUtils';

export interface DateStoreState {
  selectedDate: string;
  lastKnownToday: string;
  setSelectedDate: (date: string) => void;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  goToToday: () => void;
  /**
   * Re-anchors to today on day rollover, but only if the stored date was
   * still pointing at the previous "today" — a date the user deliberately
   * navigated to (past or future) is left alone.
   */
  syncTodayRollover: () => void;
}

/**
 * Builds one independent selected-day store.
 *
 * There are two of them, deliberately: the diary day (Home + Food + the logging
 * flows launched from them) and the Exercise tab's day. They are separate
 * because the Exercise tab's other sections are "now"-based — a workout
 * suggestion and this week's set targets do not move with a date the user
 * scrubbed back to on the Food tab.
 *
 * Neither is persisted: every fresh app launch starts on today.
 */
export function createDateStore() {
  return create<DateStoreState>((set, get) => ({
    selectedDate: getTodayDate(),
    lastKnownToday: getTodayDate(),
    setSelectedDate: (date) => set({ selectedDate: date }),
    goToPreviousDay: () => set((state) => ({ selectedDate: addDays(state.selectedDate, -1) })),
    goToNextDay: () => set((state) => ({ selectedDate: addDays(state.selectedDate, 1) })),
    goToToday: () => set({ selectedDate: getTodayDate() }),
    syncTodayRollover: () => {
      const today = getTodayDate();
      const { lastKnownToday, selectedDate } = get();
      if (today === lastKnownToday) return;
      set({
        lastKnownToday: today,
        selectedDate: selectedDate === lastKnownToday ? today : selectedDate,
      });
    },
  }));
}
