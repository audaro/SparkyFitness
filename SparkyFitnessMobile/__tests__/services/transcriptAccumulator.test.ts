import { createTranscriptAccumulator } from '../../src/services/voice/speechService';

/**
 * The two engines disagree about what a `result` event covers, so these cases
 * are transcripts of what each one actually sends for one spoken phrase.
 */
describe('createTranscriptAccumulator', () => {
  it('does not double an iOS utterance that is finalized twice', () => {
    const acc = createTranscriptAccumulator();

    // iOS streams the whole task's transcript on every result.
    expect(acc.push('log two eggs', false)).toBe('log two eggs');
    // The module's iOS-18 heuristic calls this final while the user is still
    // holding the mic open...
    expect(acc.push('log two eggs', true)).toBe('log two eggs');
    // ...and stopping capture delivers the real final: the same text again,
    // re-punctuated and space-prefixed by the module.
    expect(acc.push(' Log two eggs.', true)).toBe('Log two eggs.');

    expect(acc.text()).toBe('Log two eggs.');
  });

  it('does not double while speech continues past the first final', () => {
    const acc = createTranscriptAccumulator();

    acc.push('log two eggs', true);
    // A later iOS interim still carries everything from the start.
    expect(acc.push(' log two eggs and a coffee', false)).toBe(
      'log two eggs and a coffee'
    );
    expect(acc.push(' Log two eggs and a coffee.', true)).toBe(
      'Log two eggs and a coffee.'
    );
  });

  it('concatenates the per-utterance results Android sends', () => {
    const acc = createTranscriptAccumulator();

    expect(acc.push('log two eggs', false)).toBe('log two eggs');
    expect(acc.push('log two eggs', true)).toBe('log two eggs');
    // Android's next result covers only the new utterance.
    expect(acc.push('and a coffee', false)).toBe('log two eggs and a coffee');
    expect(acc.push('and a coffee', true)).toBe('log two eggs and a coffee');

    expect(acc.text()).toBe('log two eggs and a coffee');
  });

  it('keeps the live segment when capture ends before a final arrives', () => {
    const acc = createTranscriptAccumulator();

    acc.push('log a banana', false);
    expect(acc.text()).toBe('log a banana');
  });

  it('starts clean after a reset', () => {
    const acc = createTranscriptAccumulator();

    acc.push('log two eggs', true);
    acc.reset();

    expect(acc.text()).toBe('');
    expect(acc.push('log a banana', true)).toBe('log a banana');
  });
});
