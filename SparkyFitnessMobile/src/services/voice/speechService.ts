import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { markdownToSpokenText } from '@workspace/shared';
import { addLog } from '../LogService';

/**
 * On-device speech for Sparky voice: Apple/Android system speech recognition
 * (STT) and the platform speech synthesizer (TTS). Recognition is started with
 * `requiresOnDeviceRecognition` so audio is transcribed locally and never
 * leaves the phone; only the resulting text is sent to the user's own server.
 */

/** Recognition options shared by every Sparky voice entry point. */
export const RECOGNITION_OPTIONS = {
  interimResults: true,
  requiresOnDeviceRecognition: true,
  addsPunctuation: true,
} as const;

export interface RecognitionMode {
  /**
   * true — one utterance per press: recognition ends itself after a pause in
   * speech, which is what settles the transcript.
   * false — the mic stays open across pauses until `stopRecognition()`. Android
   * 12 and below have no continuous mode and auto-stop regardless.
   */
  autoStop: boolean;
}

/**
 * Requests mic + speech-recognition permissions. Returns true when granted.
 * Safe to call repeatedly — the OS prompt only shows once.
 */
export async function ensureVoicePermissions(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  } catch (error) {
    addLog('Voice permission request failed', 'ERROR', [
      error instanceof Error ? error.message : String(error),
    ]);
    return false;
  }
}

/** Starts one on-device recognition session. Events arrive via useSpeechRecognitionEvent. */
export function startRecognition({ autoStop }: RecognitionMode): void {
  ExpoSpeechRecognitionModule.start({
    ...RECOGNITION_OPTIONS,
    continuous: !autoStop,
  });
}

/**
 * Folds `result` events into one transcript.
 *
 * The two platforms disagree about what a result covers, and one of them
 * disagrees with itself. Android sends only the new utterance, so results have
 * to be concatenated. iOS sends `formattedString`, the whole task's transcript,
 * on every result — and emits *two* final-flagged results for one utterance:
 * the module's iOS-18 `speechDuration` heuristic fires one mid-speech, then
 * stopping capture delivers the real `isFinal`. Worse, after that first final
 * the module prepends a space as if the text were a new segment, so appending
 * it duplicates everything the user just said.
 *
 * Rather than branch on `Platform.OS` and guess which engine does what, a
 * result that already contains the transcript so far is treated as a
 * restatement and replaces it; anything else is appended. The comparison
 * ignores case, punctuation and spacing, because iOS re-punctuates and
 * re-cases the text it hands back (`addsPunctuation`).
 *
 * The one thing this cannot see is a user who repeats their entire transcript
 * verbatim as the next utterance — that reads as a restatement and collapses.
 * Losing a duplicated phrase beats duplicating every iOS utterance.
 */
export interface TranscriptAccumulator {
  /** Folds in one result event and returns the transcript so far. */
  push(transcript: string, isFinal: boolean): string;
  /** The transcript so far: finalized utterances plus the live segment. */
  text(): string;
  reset(): void;
}

/** Case, punctuation and spacing carry no meaning for the prefix comparison. */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,!?;:'"„”“‘’()[\]{}\-–—…]+/g, ' ')
    .trim();
}

export function createTranscriptAccumulator(): TranscriptAccumulator {
  let committed = '';
  let live = '';

  /** True when `text` already contains everything committed so far. */
  const restates = (text: string) =>
    committed !== '' &&
    normalizeForCompare(text).startsWith(normalizeForCompare(committed));

  const joined = () =>
    restates(live) ? live : [committed, live].filter(Boolean).join(' ');

  return {
    push(transcript, isFinal) {
      const text = transcript.trim();
      if (isFinal) {
        committed = restates(text)
          ? text
          : [committed, text].filter(Boolean).join(' ');
        live = '';
      } else {
        live = text;
      }
      return joined();
    },
    text: joined,
    reset() {
      committed = '';
      live = '';
    },
  };
}

/** Ends the audio capture; a final result then an "end" event follow. */
export function stopRecognition(): void {
  ExpoSpeechRecognitionModule.stop();
}

/** Cancels recognition without delivering a final result. */
export function abortRecognition(): void {
  ExpoSpeechRecognitionModule.abort();
}

/**
 * Speaks a Sparky reply with the on-device synthesizer, converting markdown to
 * plain speech text first. Any in-progress speech is replaced. `onDone` fires
 * on natural completion, interruption, or error, so callers can always settle
 * their UI state; it is also called synchronously when there is nothing to say.
 */
export function speakReply(markdown: string, onDone?: () => void): void {
  const text = markdownToSpokenText(markdown);
  Speech.stop();
  if (!text) {
    onDone?.();
    return;
  }
  Speech.speak(text, {
    onDone,
    onStopped: onDone,
    onError: (error) => {
      addLog('Voice reply playback failed', 'WARNING', [String(error)]);
      onDone?.();
    },
  });
}

/** Stops any in-progress spoken reply. */
export function stopSpeaking(): void {
  Speech.stop();
}
