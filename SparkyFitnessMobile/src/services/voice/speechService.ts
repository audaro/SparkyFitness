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
 * Continuous recognition emits *segments*: an interim result covers only the
 * utterance in progress and every final result is a new utterance, so the
 * finals have to be concatenated here rather than replacing what came before.
 * A non-continuous session is just the single-final case of the same rule.
 */
export interface TranscriptAccumulator {
  /** Folds in one result event and returns the transcript so far. */
  push(transcript: string, isFinal: boolean): string;
  /** The transcript so far: finalized utterances plus the live segment. */
  text(): string;
  reset(): void;
}

export function createTranscriptAccumulator(): TranscriptAccumulator {
  let committed = '';
  let live = '';
  const joined = () => [committed, live].filter(Boolean).join(' ');

  return {
    push(transcript, isFinal) {
      if (isFinal) {
        committed = [committed, transcript.trim()].filter(Boolean).join(' ');
        live = '';
      } else {
        live = transcript.trim();
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
