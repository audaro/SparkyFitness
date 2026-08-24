import { createDateStore } from './createDateStore';

/**
 * The day the Exercise tab is browsing. Independent of the diary day on
 * purpose — see `createDateStore`. Anything logged while this tab is the
 * active one is dated from here; `useAddSheetActions.getActiveDiaryDate`
 * resolves whichever tab the user was last on.
 */
export const useExerciseDateStore = createDateStore();
