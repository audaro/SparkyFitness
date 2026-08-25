import { markdownToSpokenText } from '@workspace/shared';

/**
 * Browser speech helpers for Sparky voice: dictation via the Web Speech API
 * (SpeechRecognition) and spoken replies via speechSynthesis. Both run in the
 * browser — no audio ever reaches the SparkyFitness server, only the final
 * transcript text the user sends.
 */

// lib.dom has no SpeechRecognition typings; declare the minimal surface used.
interface BrowserSpeechRecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: {
      readonly isFinal: boolean;
      0: { readonly transcript: string };
    };
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when this browser can dictate (Chrome, Edge, Safari). */
export function isDictationSupported(): boolean {
  return getRecognitionConstructor() !== null;
}

export interface DictationHandlers {
  /** Live transcript (interim + final so far); fires as the user speaks. */
  onTranscript: (text: string) => void;
  /** Dictation finished (stop() call, error, or a pause in auto-stop mode). */
  onEnd: () => void;
  onError?: (error: string) => void;
}

export interface DictationOptions {
  /**
   * true — the browser ends the session itself on the first pause in speech.
   * false (the default) — the mic stays open across pauses until `stop()`.
   */
  autoStop: boolean;
}

/** Handle on a running dictation; both methods settle it for good. */
export interface DictationSession {
  /** Ends capture and delivers what was transcribed. */
  stop(): void;
  /** Ends capture immediately, discarding anything still pending. */
  abort(): void;
}

/**
 * Chrome ends a session on its own after a stretch of silence even with
 * `continuous = true`, so hold-until-stop dictation is really a chain of
 * sessions. A session that ends this fast having heard nothing is a failing
 * engine rather than a pause — give up after a few instead of spinning the mic.
 */
const RESTART_MIN_SESSION_MS = 400;
const MAX_EMPTY_RESTARTS = 3;

function joinSegments(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/**
 * Starts one dictation and returns its handle, or null when unsupported.
 *
 * In manual mode the mic is reopened every time the engine gives up on silence,
 * so the transcript is accumulated across those restarts: `event.results` only
 * ever covers the session that produced it.
 */
export function startDictation(
  handlers: DictationHandlers,
  options: DictationOptions = { autoStop: false }
): DictationSession | null {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) return null;

  const { autoStop } = options;
  let committed = '';
  let segment = '';
  // Set once the dictation is over for good: the user stopped it, the engine
  // failed, or auto-stop heard the end of the utterance.
  let finished = false;
  let emptyRestarts = 0;
  let startedAt = 0;

  const recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  // Manual mode has to survive a pause in speech; auto-stop mode wants exactly
  // the engine's own end-of-utterance detection.
  recognition.continuous = !autoStop;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result) transcript += result[0].transcript;
    }
    segment = transcript.trim();
    handlers.onTranscript(joinSegments(committed, segment));
  };

  recognition.onerror = (event) => {
    // "no-speech"/"aborted" are normal outcomes; onend always follows and
    // decides there whether to keep listening.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    finished = true;
    handlers.onError?.(event.error);
  };

  recognition.onend = () => {
    committed = joinSegments(committed, segment);
    const heardSomething = segment !== '';
    segment = '';

    if (finished || autoStop) {
      handlers.onEnd();
      return;
    }

    const ranLongEnough = Date.now() - startedAt >= RESTART_MIN_SESSION_MS;
    emptyRestarts = heardSomething || ranLongEnough ? 0 : emptyRestarts + 1;
    if (emptyRestarts >= MAX_EMPTY_RESTARTS) {
      finished = true;
      handlers.onEnd();
      return;
    }

    try {
      startedAt = Date.now();
      recognition.start();
    } catch {
      // The engine refuses to restart; settle the UI rather than leaving the
      // button stuck in its listening state.
      finished = true;
      handlers.onEnd();
    }
  };

  startedAt = Date.now();
  recognition.start();

  return {
    stop() {
      finished = true;
      recognition.stop();
    },
    abort() {
      finished = true;
      recognition.abort();
    },
  };
}

/** True when this browser can speak replies aloud. */
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speaks a Sparky markdown reply aloud, replacing any in-progress speech. */
export function speakMarkdown(markdown: string): void {
  if (!isSpeechSynthesisSupported()) return;
  const text = markdownToSpokenText(markdown);
  window.speechSynthesis.cancel();
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || 'en-US';
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
}

/**
 * A voice preference — a tiny external store (localStorage + subscribers) so a
 * toggle and everything reading the preference stay in sync. Consume in React
 * through `useSyncExternalStore(subscribe, isEnabled)`.
 */
interface BooleanPreference {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  subscribe(listener: () => void): () => void;
}

function createBooleanPreference(
  key: string,
  defaultValue: boolean
): BooleanPreference {
  const listeners = new Set<() => void>();
  return {
    isEnabled() {
      try {
        const stored = localStorage.getItem(key);
        return stored === null ? defaultValue : stored === 'on';
      } catch {
        return defaultValue;
      }
    },
    setEnabled(enabled) {
      try {
        localStorage.setItem(key, enabled ? 'on' : 'off');
      } catch {
        // Preference simply won't persist (e.g. blocked storage); still notify.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** "Sparky speaks replies" — read assistant replies aloud. */
const voiceReplies = createBooleanPreference('sparky-voice-replies', false);

export function isVoiceRepliesEnabled(): boolean {
  return voiceReplies.isEnabled();
}

export function setVoiceRepliesEnabled(enabled: boolean): void {
  if (!enabled) stopSpeaking();
  voiceReplies.setEnabled(enabled);
}

export const subscribeVoiceReplies = voiceReplies.subscribe;

/**
 * "Stop listening on a pause" — off by default, so the mic runs until the user
 * clicks it again. Read at the moment dictation starts; flipping it mid-session
 * deliberately does not change the session already running.
 */
const dictationAutoStop = createBooleanPreference(
  'sparky-dictation-auto-stop',
  false
);

export function isDictationAutoStopEnabled(): boolean {
  return dictationAutoStop.isEnabled();
}

export function setDictationAutoStopEnabled(enabled: boolean): void {
  dictationAutoStop.setEnabled(enabled);
}

export const subscribeDictationAutoStop = dictationAutoStop.subscribe;
