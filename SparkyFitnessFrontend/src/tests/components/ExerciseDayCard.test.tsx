import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ExerciseDayCard from '@/pages/Exercises/ExerciseDayCard';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'America/Los_Angeles' }),
}));

jest.mock('@workspace/shared', () => ({
  todayInZone: () => '2026-08-24',
}));

// Both children are stubbed: this component's whole job is owning the day and
// handing it down, so the assertions are about the string that crosses that
// seam, not about what either child draws.
jest.mock('@/components/DayNavigator', () => ({
  __esModule: true,
  default: ({
    selectedDate,
    onDateChange,
  }: {
    selectedDate: string;
    onDateChange: (date: string) => void;
  }) => (
    <button type="button" onClick={() => onDateChange('2026-08-20')}>
      day:{selectedDate}
    </button>
  ),
}));

jest.mock('@/pages/Diary/ExerciseCard', () => ({
  __esModule: true,
  default: ({ selectedDate }: { selectedDate: string }) => (
    <div>entries:{selectedDate}</div>
  ),
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ExerciseDayCard />
    </MemoryRouter>
  );

describe('ExerciseDayCard', () => {
  it("defaults to today in the user's timezone", () => {
    renderAt('/exercises');

    expect(screen.getByText('entries:2026-08-24')).toBeInTheDocument();
    expect(screen.getByText('day:2026-08-24')).toBeInTheDocument();
  });

  // The Exercise page keeps the day in its own `?date=`, independent of the
  // diary's. A page opened at a past date must read that date, not today.
  it('reads the day from its own date search param', () => {
    renderAt('/exercises?date=2026-08-18');

    expect(screen.getByText('entries:2026-08-18')).toBeInTheDocument();
  });

  it('moves the entries with the day navigator', () => {
    renderAt('/exercises');

    fireEvent.click(screen.getByText('day:2026-08-24'));

    expect(screen.getByText('entries:2026-08-20')).toBeInTheDocument();
  });
});
