import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { WorkoutPresetProposalToolUI } from '@/components/ai/WorkoutPresetProposalToolUI';
import type { ProposeWorkoutPresetInput } from '@workspace/shared';

const append = jest.fn();
const state = { isLast: true, isRunning: false };

jest.mock('@assistant-ui/react', () => ({
  useThreadRuntime: () => ({ append: (...args: unknown[]) => append(...args) }),
  useMessage: (selector: (m: { isLast: boolean }) => unknown) =>
    selector({ isLast: state.isLast }),
  useThread: (selector: (t: { isRunning: boolean }) => unknown) =>
    selector({ isRunning: state.isRunning }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValueOrOpts?: string | Record<string, unknown>
    ) => {
      if (typeof defaultValueOrOpts === 'string') return defaultValueOrOpts;
      if (defaultValueOrOpts && typeof defaultValueOrOpts === 'object') {
        let text = String(defaultValueOrOpts['defaultValue'] ?? _key);
        for (const [k, v] of Object.entries(defaultValueOrOpts)) {
          if (k === 'defaultValue') continue;
          text = text.replaceAll(`{{${k}}}`, String(v));
        }
        return text;
      }
      return _key;
    },
  }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ weightUnit: 'kg' }),
}));

const createPreset = jest.fn();
const deletePreset = jest.fn();
const updatePreset = jest.fn();
const getWorkoutPresetById = jest.fn();
jest.mock('@/hooks/Exercises/useWorkoutPresets', () => ({
  useCreateWorkoutPresetMutation: () => ({
    mutateAsync: createPreset,
    isPending: false,
  }),
  useDeleteWorkoutPresetMutation: () => ({
    mutateAsync: deletePreset,
    isPending: false,
  }),
  useUpdateWorkoutPresetMutation: () => ({
    mutateAsync: updatePreset,
    isPending: false,
  }),
  useFetchWorkoutPresetById:
    () =>
    (...args: unknown[]) =>
      getWorkoutPresetById(...args),
}));

// The full preset editor drags in dnd-kit and the exercise picker; the card
// only needs to know it was asked to open.
jest.mock('@/pages/Exercises/WorkoutPresetForm', () => ({
  __esModule: true,
  default: () => <div data-testid="preset-form" />,
}));

const args: ProposeWorkoutPresetInput = {
  name: 'Push Day',
  description: 'Chest, shoulders, triceps',
  rationale: 'Balances pressing volume with your recovery.',
  exercises: [
    {
      exercise_id: 'ex-1',
      exercise_name: 'Bench Press',
      modality: 'weight_reps',
      sort_order: 0,
      sets: [
        { set_number: 1, set_type: 'Warmup', reps: 5, weight: 40 },
        { set_number: 2, reps: 8, weight: 60, rest_time: 120 },
      ],
    },
    {
      exercise_id: 'ex-2',
      exercise_name: 'Overhead Press',
      sort_order: 1,
      superset_group: 1,
      sets: [{ set_number: 1, reps: 10, weight: 30 }],
    },
  ],
};

const renderCard = (partial: Partial<ProposeWorkoutPresetInput> = {}) =>
  render(
    <WorkoutPresetProposalToolUI
      {...({
        args: { ...args, ...partial },
        toolCallId: 'tc-1',
      } as unknown as ToolCallMessagePartProps<ProposeWorkoutPresetInput>)}
    />
  );

describe('WorkoutPresetProposalToolUI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.isLast = true;
    state.isRunning = false;
    createPreset.mockResolvedValue({ id: 'preset-9', name: 'Push Day' });
    deletePreset.mockResolvedValue({ message: 'ok' });
  });

  it('renders the routine with exercises, programming, and rationale', () => {
    renderCard();
    expect(screen.getByText('Push Day')).toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Overhead Press')).toBeInTheDocument();
    expect(
      screen.getByText('Balances pressing volume with your recovery.')
    ).toBeInTheDocument();
    expect(screen.getByText('Superset 1')).toBeInTheDocument();
    expect(screen.getByText('2 exercises · 3 sets')).toBeInTheDocument();
    expect(screen.getByText('60 kg')).toBeInTheDocument();
  });

  // Tool input arrives as partial JSON while streaming; a half-built proposal
  // must not flash an empty card.
  it('renders nothing until the name and an exercise have streamed in', () => {
    const { container } = renderCard({ exercises: [] });
    expect(container).toBeEmptyDOMElement();

    const { container: noName } = renderCard({
      name: undefined as unknown as string,
    });
    expect(noName).toBeEmptyDOMElement();
  });

  it('accepts by committing through the REST mutation and telling the model', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(createPreset).toHaveBeenCalledTimes(1));
    expect(createPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Push Day',
        is_public: false,
        user_id: 'user-1',
        exercises: [
          expect.objectContaining({
            exercise_id: 'ex-1',
            sort_order: 0,
            sets: [
              expect.objectContaining({
                set_number: 1,
                set_type: 'Warmup',
                reps: 5,
                weight: 40,
              }),
              expect.objectContaining({
                set_number: 2,
                set_type: 'Working Set',
                reps: 8,
                weight: 60,
                rest_time: 120,
              }),
            ],
          }),
          expect.objectContaining({
            exercise_id: 'ex-2',
            sort_order: 1,
            superset_group: 1,
          }),
        ],
      })
    );
    await waitFor(() =>
      expect(append).toHaveBeenCalledWith({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'I accepted the proposed routine "Push Day".',
          },
        ],
      })
    );
    expect(screen.getByText('Created ✓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('undoes an accepted proposal by deleting the created preset', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(deletePreset).toHaveBeenCalledWith('preset-9'));
    await waitFor(() =>
      expect(append).toHaveBeenCalledWith({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'I undid the routine "Push Day" — it was deleted.',
          },
        ],
      })
    );
    // Back to proposable.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('opens the full preset editor seeded from the server after accept', async () => {
    getWorkoutPresetById.mockResolvedValue({
      id: 'preset-9',
      user_id: 'user-1',
      name: 'Push Day',
      exercises: [],
    });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() =>
      expect(getWorkoutPresetById).toHaveBeenCalledWith('preset-9')
    );
    await waitFor(() =>
      expect(screen.getByTestId('preset-form')).toBeInTheDocument()
    );
  });

  it('sends revision feedback as an ordinary user message', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    fireEvent.change(
      screen.getByPlaceholderText(
        'What should change? e.g. “less volume, no barbell work”'
      ),
      { target: { value: 'less bench volume' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(append).toHaveBeenCalledWith({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Please revise the proposal: less bench volume',
        },
      ],
    });
    expect(createPreset).not.toHaveBeenCalled();
  });

  // A card on a scrolled-back message would commit a proposal the chat has
  // already moved past.
  it('disables Accept once the message is no longer the last', () => {
    state.isLast = false;
    renderCard();
    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    expect(createPreset).not.toHaveBeenCalled();
  });

  it('disables Accept while the thread is running', () => {
    state.isRunning = true;
    renderCard();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });
});
