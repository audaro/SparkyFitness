import { render, fireEvent } from '@testing-library/react-native';

import CoachNoteCard from '../../src/components/CoachNoteCard';

const NOTE =
  'Built around quadriceps, calves and glutes — the freshest muscles you have today, at 92% recovered on average. Sets and reps are shaped for hypertrophy.';

describe('CoachNoteCard', () => {
  it('renders the engine paragraph verbatim', () => {
    // Server-generated English, like the per-exercise rationale beside it —
    // nothing here translates or reflows it.
    const { getByText } = render(<CoachNoteCard rationale={NOTE} />);
    expect(getByText(NOTE)).toBeTruthy();
    expect(getByText('Coach')).toBeTruthy();
  });

  it('opens expanded and folds to two lines when tapped', () => {
    // A card that hid itself on first open would never be found; a reader who
    // does not want it should still be able to fold it away.
    const { getByText, getByTestId } = render(
      <CoachNoteCard rationale={NOTE} />
    );
    expect(getByText(NOTE).props.numberOfLines).toBeUndefined();

    fireEvent.press(getByTestId('coach-note-card'));
    expect(getByText(NOTE).props.numberOfLines).toBe(2);

    fireEvent.press(getByTestId('coach-note-card'));
    expect(getByText(NOTE).props.numberOfLines).toBeUndefined();
  });

  it('speaks the whole note as one element, collapsed or not', () => {
    // The paragraph is the card's only content, so a focusable child would
    // make VoiceOver read it twice.
    const { getByTestId } = render(<CoachNoteCard rationale={NOTE} />);
    const card = getByTestId('coach-note-card');
    expect(card.props.accessibilityLabel).toBe(`Coach note: ${NOTE}`);
    expect(card.props.accessibilityState).toEqual({ expanded: true });

    fireEvent.press(card);
    expect(getByTestId('coach-note-card').props.accessibilityLabel).toBe(
      `Coach note: ${NOTE}`
    );
  });

  it('renders nothing for a blank rationale', () => {
    const { queryByTestId } = render(<CoachNoteCard rationale="   " />);
    expect(queryByTestId('coach-note-card')).toBeNull();
  });
});
