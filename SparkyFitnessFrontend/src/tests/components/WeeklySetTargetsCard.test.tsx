import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeeklySetTargetsCard from '@/pages/Exercises/WeeklySetTargetsCard';
import type { WeeklySetTargets } from '@/hooks/Exercises/useWeeklySetTargets';

const mockSaveTargets = jest.fn();

let mockIsActingOnBehalf = false;
let mockData: WeeklySetTargets | undefined;
let mockQueryState = { isLoading: false, isError: false };

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
        return key;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ isActingOnBehalf: mockIsActingOnBehalf }),
}));

jest.mock('@/hooks/Exercises/useWeeklySetTargets', () => ({
  useWeeklySetTargets: () => ({
    data: mockData,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
  }),
  useUpdateWeeklySetTargetsMutation: () => ({
    mutate: mockSaveTargets,
    isPending: false,
  }),
}));

const makeData = (
  overrides: Partial<WeeklySetTargets> = {}
): WeeklySetTargets => ({
  current: {
    week_start: '2026-08-23',
    week_end: '2026-08-29',
    groups: [
      {
        group: 'push',
        completed: 7.5,
        target: 12,
        remaining: 4.5,
        percent: 0.625,
      },
      { group: 'pull', completed: 12, target: 12, remaining: 0, percent: 1 },
      { group: 'legs', completed: 0, target: 0, remaining: 0, percent: 1 },
      { group: 'core', completed: 3, target: 6, remaining: 3, percent: 0.5 },
    ],
    overall_percent: 0.77,
  },
  history: [],
  targets_are_custom: true,
  ...overrides,
});

describe('WeeklySetTargetsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsActingOnBehalf = false;
    mockData = makeData();
    mockQueryState = { isLoading: false, isError: false };
  });

  it('renders nothing while acting on behalf of another user', () => {
    mockIsActingOnBehalf = true;

    const { container } = render(<WeeklySetTargetsCard />);

    // coach_profiles is owner-only at the RLS layer, so the route 403s for a
    // delegate rather than reporting derived defaults as the owner's choice.
    expect(container).toBeEmptyDOMElement();
  });

  it('never rounds a fractional set count away', () => {
    render(<WeeklySetTargetsCard />);

    // A secondary mover contributes half a set, so 7.5 is a real number.
    expect(screen.getByText('7.5 / 12 sets')).toBeInTheDocument();
    expect(screen.getByText('4.5 to go')).toBeInTheDocument();
  });

  it('renders a whole count without a trailing decimal', () => {
    render(<WeeklySetTargetsCard />);

    expect(screen.getByText('12 / 12 sets')).toBeInTheDocument();
  });

  it('says a zero-target group is not tracked rather than showing 0 to go', () => {
    render(<WeeklySetTargetsCard />);

    expect(screen.getByText('Not tracked')).toBeInTheDocument();
  });

  it('shows the overall percentage as a whole number', () => {
    render(<WeeklySetTargetsCard />);

    expect(screen.getByTestId('weekly-set-targets-overall')).toHaveTextContent(
      '77%'
    );
  });

  it('flags targets the server derived rather than the user choosing', () => {
    mockData = makeData({ targets_are_custom: false });

    render(<WeeklySetTargetsCard />);

    expect(
      screen.getByText(/These targets are a starting point/)
    ).toBeInTheDocument();
  });

  it('sends only the group that changed', () => {
    render(<WeeklySetTargetsCard />);

    fireEvent.click(screen.getByLabelText('Edit Push Muscles target'));
    const input = screen.getByLabelText('Push Muscles weekly set target');
    fireEvent.change(input, { target: { value: '18' } });
    fireEvent.click(screen.getByLabelText('Save'));

    // The server merges a partial map; resending all four would clobber an
    // edit made elsewhere between load and save.
    expect(mockSaveTargets).toHaveBeenCalledWith({ push: 18 });
  });

  it('saves nothing when the number did not move', () => {
    render(<WeeklySetTargetsCard />);

    fireEvent.click(screen.getByLabelText('Edit Core Muscles target'));
    fireEvent.click(screen.getByLabelText('Save'));

    // A no-op request would still flip targets_are_custom and claim a derived
    // default as a choice the user made.
    expect(mockSaveTargets).not.toHaveBeenCalled();
  });

  it('treats a cleared field as a cancel, not a target of zero', () => {
    render(<WeeklySetTargetsCard />);

    fireEvent.click(screen.getByLabelText('Edit Push Muscles target'));
    fireEvent.change(screen.getByLabelText('Push Muscles weekly set target'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByLabelText('Save'));

    // 0 means "not training this group in this block" — a real choice nobody
    // makes by emptying a box.
    expect(mockSaveTargets).not.toHaveBeenCalled();
  });

  it('clamps an entry above the server ceiling instead of being rejected', () => {
    render(<WeeklySetTargetsCard />);

    fireEvent.click(screen.getByLabelText('Edit Leg Muscles target'));
    fireEvent.change(screen.getByLabelText('Leg Muscles weekly set target'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByLabelText('Save'));

    expect(mockSaveTargets).toHaveBeenCalledWith({ legs: 100 });
  });

  it('commits on Enter and abandons on Escape', () => {
    render(<WeeklySetTargetsCard />);

    fireEvent.click(screen.getByLabelText('Edit Push Muscles target'));
    const input = screen.getByLabelText('Push Muscles weekly set target');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSaveTargets).toHaveBeenCalledWith({ push: 20 });

    mockSaveTargets.mockClear();
    fireEvent.click(screen.getByLabelText('Edit Pull Muscles target'));
    const pullInput = screen.getByLabelText('Pull Muscles weekly set target');
    fireEvent.change(pullInput, { target: { value: '30' } });
    fireEvent.keyDown(pullInput, { key: 'Escape' });
    expect(mockSaveTargets).not.toHaveBeenCalled();
  });

  it('commits the open editor when another group is opened', () => {
    render(<WeeklySetTargetsCard />);

    fireEvent.click(screen.getByLabelText('Edit Push Muscles target'));
    fireEvent.change(screen.getByLabelText('Push Muscles weekly set target'), {
      target: { value: '18' },
    });
    // Clicking a second Edit is not the same gesture as clicking Cancel; a
    // silently dropped number would look like a save that failed.
    fireEvent.click(screen.getByLabelText('Edit Core Muscles target'));

    expect(mockSaveTargets).toHaveBeenCalledWith({ push: 18 });
    expect(
      screen.getByLabelText('Core Muscles weekly set target')
    ).toBeInTheDocument();
  });

  it('lists history newest first', () => {
    mockData = makeData({
      history: [
        {
          ...makeData().current,
          week_start: '2026-08-09',
          overall_percent: 0.4,
        },
        {
          ...makeData().current,
          week_start: '2026-08-16',
          overall_percent: 0.9,
        },
      ],
    });

    render(<WeeklySetTargetsCard />);

    // The wire sends history oldest-first; the week just gone belongs next to
    // the current one.
    const labels = screen
      .getAllByText(/^Aug \d+$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(['Aug 16', 'Aug 9']);
  });

  it('keeps showing a cached week when a refetch fails', () => {
    mockQueryState = { isLoading: false, isError: true };

    render(<WeeklySetTargetsCard />);

    expect(screen.getByText('7.5 / 12 sets')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load your weekly targets.')
    ).not.toBeInTheDocument();
  });

  it('reports the failure when there is nothing cached', () => {
    mockData = undefined;
    mockQueryState = { isLoading: false, isError: true };

    render(<WeeklySetTargetsCard />);

    expect(
      screen.getByText('Failed to load your weekly targets.')
    ).toBeInTheDocument();
  });
});
