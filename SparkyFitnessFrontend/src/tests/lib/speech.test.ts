import {
  isDictationAutoStopEnabled,
  setDictationAutoStopEnabled,
  startDictation,
  subscribeDictationAutoStop,
  type BrowserSpeechRecognition,
} from '@/lib/speech';

/**
 * Stand-in for the browser's SpeechRecognition. `emit*` plays the engine's side
 * of a session so a test can act out a pause, a restart, or a hard error.
 */
class FakeRecognition implements BrowserSpeechRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  continuous = false;
  interimResults = false;
  onresult: BrowserSpeechRecognition['onresult'] = null;
  onend: BrowserSpeechRecognition['onend'] = null;
  onerror: BrowserSpeechRecognition['onerror'] = null;

  starts = 0;
  stops = 0;
  aborts = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }

  abort(): void {
    this.aborts += 1;
  }

  /** One result event; `transcript` is the whole session's text so far. */
  emitResult(transcript: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: true, 0: { transcript } },
      },
    });
  }

  emitError(error: string): void {
    this.onerror?.({ error });
  }

  emitEnd(): void {
    this.onend?.();
  }
}

const only = (): FakeRecognition => {
  expect(FakeRecognition.instances).toHaveLength(1);
  return FakeRecognition.instances[0]!;
};

beforeEach(() => {
  FakeRecognition.instances = [];
  localStorage.clear();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    FakeRecognition;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition;
});

describe('startDictation', () => {
  it('hands the session to the engine to end when auto-stop is on', () => {
    const onEnd = jest.fn();
    const onTranscript = jest.fn();

    startDictation({ onTranscript, onEnd }, { autoStop: true });

    const recognition = only();
    expect(recognition.continuous).toBe(false);

    recognition.emitResult('two eggs');
    recognition.emitEnd();

    expect(onTranscript).toHaveBeenLastCalledWith('two eggs');
    expect(onEnd).toHaveBeenCalledTimes(1);
    // The engine's own end is the end of the dictation: no second session.
    expect(recognition.starts).toBe(1);
  });

  it('keeps listening across pauses in manual mode, accumulating segments', () => {
    const onEnd = jest.fn();
    const onTranscript = jest.fn();

    const session = startDictation(
      { onTranscript, onEnd },
      { autoStop: false }
    );

    const recognition = only();
    expect(recognition.continuous).toBe(true);

    recognition.emitResult('log two eggs');
    // Chrome gives up on silence even in continuous mode; that is a pause, not
    // the end of the dictation.
    recognition.emitError('no-speech');
    recognition.emitEnd();

    expect(onEnd).not.toHaveBeenCalled();
    expect(recognition.starts).toBe(2);

    // A restarted session's results only cover the new segment.
    recognition.emitResult('and a coffee');
    expect(onTranscript).toHaveBeenLastCalledWith('log two eggs and a coffee');

    session?.stop();
    recognition.emitEnd();

    expect(recognition.stops).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than spinning the mic when restarts keep coming back empty', () => {
    const onEnd = jest.fn();

    startDictation({ onTranscript: jest.fn(), onEnd }, { autoStop: false });

    const recognition = only();
    // Each end is immediate and heard nothing — a failing engine, not a pause.
    recognition.emitEnd();
    recognition.emitEnd();
    recognition.emitEnd();

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(recognition.starts).toBe(3);

    // Settled for good: no further restarts.
    recognition.emitEnd();
    expect(recognition.starts).toBe(3);
  });

  it('ends the dictation on a real engine error instead of restarting', () => {
    const onEnd = jest.fn();
    const onError = jest.fn();

    startDictation(
      { onTranscript: jest.fn(), onEnd, onError },
      { autoStop: false }
    );

    const recognition = only();
    recognition.emitError('audio-capture');
    recognition.emitEnd();

    expect(onError).toHaveBeenCalledWith('audio-capture');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(recognition.starts).toBe(1);
  });

  it('returns null when the browser has no Web Speech API', () => {
    delete (window as unknown as { SpeechRecognition?: unknown })
      .SpeechRecognition;
    expect(
      startDictation({ onTranscript: jest.fn(), onEnd: jest.fn() })
    ).toBeNull();
  });
});

describe('the auto-stop preference', () => {
  it('defaults to off, so dictation runs until the user stops it', () => {
    expect(isDictationAutoStopEnabled()).toBe(false);
  });

  it('persists and notifies subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDictationAutoStop(listener);

    setDictationAutoStopEnabled(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(isDictationAutoStopEnabled()).toBe(true);

    unsubscribe();
    setDictationAutoStopEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isDictationAutoStopEnabled()).toBe(false);
  });
});
