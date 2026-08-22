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
  /** Recognition finished (pause in speech, stop() call, or error). */
  onEnd: () => void;
  onError?: (error: string) => void;
}

/**
 * Starts one dictation session and returns the recognition handle (call
 * `stop()` to end it early), or null when unsupported.
 */
export function startDictation(
  handlers: DictationHandlers
): BrowserSpeechRecognition | null {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result) transcript += result[0].transcript;
    }
    handlers.onTranscript(transcript.trim());
  };
  recognition.onerror = (event) => {
    // "no-speech"/"aborted" are normal outcomes; onend always follows.
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      handlers.onError?.(event.error);
    }
  };
  recognition.onend = () => handlers.onEnd();

  recognition.start();
  return recognition;
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
 * "Sparky speaks replies" preference — a tiny external store (localStorage +
 * subscribers) so the composer toggle and the speak-on-settle listener stay in
 * sync. Consume in React through `useSyncExternalStore(subscribeVoiceReplies,
 * isVoiceRepliesEnabled)`.
 */
const VOICE_REPLIES_KEY = 'sparky-voice-replies';
const voiceReplyListeners = new Set<() => void>();

export function isVoiceRepliesEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_REPLIES_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setVoiceRepliesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(VOICE_REPLIES_KEY, enabled ? 'on' : 'off');
  } catch {
    // Preference simply won't persist (e.g. blocked storage); still notify.
  }
  if (!enabled) stopSpeaking();
  voiceReplyListeners.forEach((listener) => listener());
}

export function subscribeVoiceReplies(listener: () => void): () => void {
  voiceReplyListeners.add(listener);
  return () => voiceReplyListeners.delete(listener);
}
