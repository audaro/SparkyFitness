import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TrainingPlanCard from '@/pages/Exercises/TrainingPlanCard';
import type { CoachProfile } from '@/hooks/Exercises/useCoachProfile';
import type { WeeklySetTargets } from '@/hooks/Exercises/useWeeklySetTargets';

/**
 * The web training plan.
 *
 * Mobile asks the same questions as a wizard and this asks them at once, so
 * what has to be tested is the thing the two must agree on: the patch. One
 * PATCH with every answer, a completion stamp the save owns, and a dose stored
 * as the amount and interval the user stated rather than as a weekly average.
 */

let mockAvailable = true;
let mockProfile: CoachProfile | undefined;
let mockTargets: WeeklySetTargets | undefined;
const mockSavePlan = jest.fn();
const mockClearTargets = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrValues?: string | Record<string, unknown>) => {
      if (typeof defaultOrValues === 'string') return defaultOrValues;
      if (defaultOrValues && typeof defaultOrValues === 'object') {
        const { defaultValue, ...values } = defaultOrValues as {
          defaultValue?: string;
        } & Record<string, unknown>;
        if (typeof defaultValue === 'string') {
          return defaultValue.replace(
            /\{\{(\w+)\}\}/g,
            (_match, name: string) => String(values[name] ?? '')
          );
        }
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Radix's Select never opens in jsdom; this renders every option as a button,
// the same stand-in `UpNextCard.test.tsx` uses for its experience select.
jest.mock('@/components/ui/select', () => {
  const SelectContext = React.createContext<(value: string) => void>(() => {});
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <SelectContext.Provider value={onValueChange ?? (() => {})}>
        {children}
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectItem: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const onValueChange = React.useContext(SelectContext);
      return (
        <button
          type="button"
          data-value={value}
          onClick={() => onValueChange(value)}
        >
          {children}
        </button>
      );
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectValue: () => <span />,
  };
});

jest.mock('@/hooks/Exercises/useCoachingContextAvailable', () => ({
  useCoachingContextAvailable: () => mockAvailable,
}));

jest.mock('@/hooks/Exercises/useCoachProfile', () => ({
  useCoachProfile: () => ({ data: mockProfile }),
  useSaveTrainingPlanMutation: () => ({
    mutate: mockSavePlan,
    isPending: false,
  }),
}));

jest.mock('@/hooks/Exercises/useWeeklySetTargets', () => ({
  useWeeklySetTargets: () => ({ data: mockTargets }),
  useClearWeeklySetTargetsMutation: () => ({ mutate: mockClearTargets }),
}));

function makeProfile(overrides: Partial<CoachProfile> = {}): CoachProfile {
  return {
    goals: null,
    training_days_per_week: null,
    session_minutes: null,
    experience_level: null,
    limitations: [],
    primary_goal: null,
    physique_target: null,
    priority_muscle_groups: null,
    enhancement: null,
    plan_completed_at: null,
    ...overrides,
  } as CoachProfile;
}

function makeTargets(custom: boolean): WeeklySetTargets {
  return {
    current: {
      week_start: '2026-09-13',
      week_end: '2026-09-19',
      groups: [],
      overall_percent: 0,
    },
    history: [],
    targets_are_custom: custom,
  } as WeeklySetTargets;
}

/** Opens the inline editor, which is where every answer is given. */
function openEditor() {
  render(<TrainingPlanCard />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Set up your training plan' })
  );
}

describe('TrainingPlanCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable = true;
    mockProfile = makeProfile();
    mockTargets = makeTargets(false);
  });

  // Owner-only, like every other coaching surface on this page.
  it('renders nothing while acting for someone else', () => {
    mockAvailable = false;
    render(<TrainingPlanCard />);
    expect(screen.queryByTestId('training-plan-card')).toBeNull();
  });

  // `undefined` is a read in flight or one that failed — never a user with no
  // plan, since the endpoint answers a row of nulls for that. Opening there
  // seeds the defaults, and saving would write them over a stored plan the
  // user never got to see.
  it('will not open the editor before the profile has been read', () => {
    mockProfile = undefined;
    render(<TrainingPlanCard />);

    const open = screen.getByRole('button', {
      name: 'Set up your training plan',
    });
    expect(open).toBeDisabled();

    fireEvent.click(open);
    expect(screen.queryByRole('button', { name: 'Save my plan' })).toBeNull();
  });

  // A dose over the contract's bound used to be quietly rewritten to the
  // maximum, which answers a question about the user's own protocol on their
  // behalf and reopens showing a figure they never typed.
  it('refuses an out-of-range dose instead of rewriting it', () => {
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'On TRT' }));
    fireEvent.change(screen.getByLabelText('Milligrams per injection'), {
      target: { value: '5000' },
    });

    expect(screen.getByTestId('training-plan-dose-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save my plan' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Milligrams per injection'), {
      target: { value: '250' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));

    expect(mockSavePlan.mock.calls[0][0].enhancement).toMatchObject({
      testosterone_mg_per_dose: 250,
    });
  });

  it('sends every answer as one patch', () => {
    openEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Build muscle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Muscular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pull Muscles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Knee pain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));

    expect(mockSavePlan).toHaveBeenCalled();
    const patch = mockSavePlan.mock.calls[0][0];
    expect(patch.primary_goal).toBe('build_muscle');
    expect(patch.physique_target).toBe('muscular');
    expect(patch.experience_level).toBe('expert');
    expect(patch.priority_muscle_groups).toEqual(['pull']);
    expect(patch.limitations).toEqual(['Knee pain']);
    expect(patch.enhancement).toEqual({ status: 'natural' });
    // The stamp belongs to the mutation, not the form — it is what says the
    // questionnaire was answered, and every caller must set it the same way.
    expect(patch.plan_completed_at).toBeUndefined();
  });

  // Past two, each priority stops taking share from the others, so the cap is
  // part of what the answer means rather than a UI nicety.
  it('keeps at most two priority groups', () => {
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Push Muscles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pull Muscles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leg Muscles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));

    expect(mockSavePlan.mock.calls[0][0].priority_muscle_groups).toEqual([
      'pull',
      'legs',
    ]);
  });

  // The whole reason the stored shape is a dose and an interval rather than a
  // weekly average: 1000 mg every ten weeks must not reopen as 100 mg.
  it('stores a long-interval dose as stated', () => {
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'On TRT' }));
    fireEvent.change(screen.getByLabelText('Milligrams per injection'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undecanoate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));

    expect(mockSavePlan.mock.calls[0][0].enhancement).toEqual({
      status: 'trt',
      testosterone_mg_per_dose: 1000,
      dose_interval_weeks: 10,
      ester: 'undecanoate',
    });
  });

  // A weekly ester needs no interval at all, and sending one would state an
  // answer the user was never asked for.
  it('omits the interval for a weekly protocol', () => {
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'On TRT' }));
    fireEvent.change(screen.getByLabelText('Milligrams per injection'), {
      target: { value: '140' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cypionate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));

    expect(mockSavePlan.mock.calls[0][0].enhancement).toEqual({
      status: 'trt',
      testosterone_mg_per_dose: 140,
      ester: 'cypionate',
    });
  });

  it('reopens a stored dose as the number the user typed', () => {
    mockProfile = makeProfile({
      plan_completed_at: '2026-09-16T10:00:00.000Z',
      enhancement: {
        status: 'trt',
        testosterone_mg_per_dose: 1000,
        dose_interval_weeks: 10,
        ester: 'undecanoate',
      },
    });
    render(<TrainingPlanCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }));

    expect(screen.getByLabelText('Milligrams per injection')).toHaveValue(1000);
  });

  // A hand-set target silently overrides everything the plan derives, so the
  // save has to ask rather than leave the ring disagreeing with the plan.
  it('offers to replace hand-set weekly targets', () => {
    mockTargets = makeTargets(true);
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));

    expect(mockSavePlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use the plan' }));

    expect(mockSavePlan).toHaveBeenCalled();
    // The clear runs on the save's success, not beside it: dropping the
    // overrides for a plan that never landed would leave the user with
    // neither.
    expect(mockClearTargets).not.toHaveBeenCalled();
    mockSavePlan.mock.calls[0][1].onSuccess();
    expect(mockClearTargets).toHaveBeenCalled();
  });

  it('leaves the hand-set targets alone when the user keeps them', () => {
    mockTargets = makeTargets(true);
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save my plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(mockSavePlan).toHaveBeenCalled();
    mockSavePlan.mock.calls[0][1].onSuccess();
    expect(mockClearTargets).not.toHaveBeenCalled();
  });
});
