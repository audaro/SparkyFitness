import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { todayInZone } from '@workspace/shared';

import DayNavigator from '@/components/DayNavigator';
import ExerciseCard from '@/pages/Diary/ExerciseCard';
import { usePreferences } from '@/contexts/PreferencesContext';

/**
 * The day's logged exercise, on the Exercise page.
 *
 * This used to be a widget on the diary. It moved here so that everything about
 * training — what to do next, how recovered you are, what you have already
 * done, and the library you build it all from — is on one page, and the diary
 * is about food.
 *
 * **The day is this page's own, not the diary's.** Both pages keep it in their
 * own `?date=` search param, so browsing back through last week's workouts does
 * not move the food diary, and vice versa. That is deliberate: they are two
 * independent readings of a day and there is no shared logging affordance on
 * the web that could pick the wrong one (mobile needed a rule for exactly that
 * — its Add sheet had to be taught which tab's day to use).
 */
const ExerciseDayCard: React.FC = () => {
  const { timezone } = usePreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDate = searchParams.get('date') ?? todayInZone(timezone);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <DayNavigator
          selectedDate={selectedDate}
          onDateChange={(dateString) => setSearchParams({ date: dateString })}
          className="grid-cols-none flex mb-0 items-center gap-2"
        />
      </div>
      {/* No-op: `onExercisesLogged` only fires after a preset queue handed in
          through `initialExercisesToLog`, which nothing passes here. */}
      <ExerciseCard selectedDate={selectedDate} onExercisesLogged={() => {}} />
    </div>
  );
};

export default ExerciseDayCard;
