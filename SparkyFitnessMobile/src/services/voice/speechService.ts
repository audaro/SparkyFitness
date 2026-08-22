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
  // One utterance per press: recognition ends itself after a pause in speech,
  // which is what auto-sends the transcript.
  continuous: false,
  requiresOnDeviceRecognition: true,
  addsPunctuation: true,
} as const;

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
export function startRecognition(): void {
  ExpoSpeechRecognitionModule.start({ ...RECOGNITION_OPTIONS });
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
