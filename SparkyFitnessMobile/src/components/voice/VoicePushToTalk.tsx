import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import Toast from 'react-native-toast-message';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import Icon from '../Icon';
import { navigationRef, useActiveWorkoutBarPadding } from '../ActiveWorkoutBar';
import { useAppPreferencesStore } from '../../stores/appPreferencesStore';
import { useActiveAiServiceSetting } from '../../hooks';
import { postQuickLog } from '../../services/api/quickLogApi';
import {
  abortRecognition,
  createTranscriptAccumulator,
  ensureVoicePermissions,
  speakReply,
  startRecognition,
  stopRecognition,
  stopSpeaking,
} from '../../services/voice/speechService';
import { addLog } from '../../services/LogService';

/**
 * Global push-to-talk for Sparky: a floating mic available on every screen.
 * Tap → on-device speech recognition (live transcript) → a second tap ends
 * capture (or a pause in speech does, with the auto-stop preference on) → the
 * transcript is sent to the one-shot `/api/chat/quick-log` endpoint → the reply
 * is shown and, when enabled, spoken aloud by the on-device synthesizer.
 *
 * Mounted once in App.tsx beside ActiveWorkoutBar, outside the screen tree.
 */

/**
 * Routes where the mic must not float: modal entry flows and editors with
 * their own bottom chrome (mirrors ActiveWorkoutBar's list), the chat screen
 * (it has its own composer mic), Android-style modal routes that share the
 * window, and first-run onboarding.
 */
const VOICE_HIDDEN_ROUTES = new Set<string>([
  'Onboarding',
  'FoodSearch',
  'FoodEntryAdd',
  'FoodForm',
  'FoodScan',
  'FoodPhotoIntro',
  'FoodPhotoFlow',
  'EditBarcode',
  'ExerciseSearch',
  'WorkoutAdd',
  'ActivityAdd',
  'MeasurementsAdd',
  'Chat',
  'ActiveWorkout',
  'WorkoutComplete',
  'CycleLogModal',
  'MedicationForm',
  'MedicationScheduleForm',
]);

type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done' | 'error';

/** Tracks the top root-route name so the button can hide on conflicting screens. */
function useTopRouteName(): string | null {
  const [name, setName] = useState<string | null>(() =>
    navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? null) : null
  );

  useEffect(() => {
    const update = () => {
      if (!navigationRef.isReady()) return;
      const state = navigationRef.getRootState();
      const index = state?.index ?? 0;
      setName(state?.routes[index]?.name ?? null);
    };
    update();
    const unsubscribe = navigationRef.addListener('state', update);
    return unsubscribe;
  }, []);

  return name;
}

export default function VoicePushToTalk() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const voiceButtonVisible = useAppPreferencesStore((s) => s.voiceButtonVisible);
  const voiceRepliesEnabled = useAppPreferencesStore((s) => s.voiceRepliesEnabled);
  const voiceAutoStopEnabled = useAppPreferencesStore((s) => s.voiceAutoStopEnabled);
  const { data: aiSetting } = useActiveAiServiceSetting();
  const topRoute = useTopRouteName();
  const workoutBarPadding = useActiveWorkoutBarPadding('tabs');

  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [errorText, setErrorText] = useState('');
  // Guards stale async callbacks (network replies, TTS onDone) after the user
  // cancels or starts a new utterance.
  const sessionRef = useRef(0);
  const transcriptRef = useRef(createTranscriptAccumulator());

  const [accent, surface, border, textPrimary, muted, dangerText, dangerIcon] = useCSSVariable([
    '--color-accent-primary',
    '--color-surface',
    '--color-border-subtle',
    '--color-text-primary',
    '--color-text-muted',
    '--color-text-danger-subtle',
    '--color-icon-danger',
  ]) as [string, string, string, string, string, string, string];

  const resetToIdle = useCallback(() => {
    sessionRef.current += 1;
    stopSpeaking();
    setPhase('idle');
    setTranscript('');
    setReply('');
    setErrorText('');
  }, []);

  const serviceConfigId = aiSetting?.id;
  const sendTranscript = useCallback(
    async (message: string) => {
      const session = ++sessionRef.current;
      setPhase('thinking');
      try {
        const result = await postQuickLog(message, serviceConfigId);
        if (sessionRef.current !== session) return;
        setReply(result.text);
        if (voiceRepliesEnabled) {
          setPhase('speaking');
          speakReply(result.text, () => {
            if (sessionRef.current === session) setPhase('done');
          });
        } else {
          setPhase('done');
        }
      } catch (error) {
        if (sessionRef.current !== session) return;
        const message_ = error instanceof Error ? error.message : String(error);
        addLog('Voice quick-log failed', 'ERROR', [message_]);
        setErrorText(message_ || 'Something went wrong. Try again.');
        setPhase('error');
      }
    },
    [serviceConfigId, voiceRepliesEnabled]
  );

  // Recognition events are module-global; gate on our own listening phase so
  // the chat screen's dictation (same module) never cross-talks. The hook
  // always invokes the latest closure, so `phase` is current here.
  useSpeechRecognitionEvent('result', (event) => {
    if (phase !== 'listening') return;
    setTranscript(transcriptRef.current.push(event.results[0]?.transcript ?? '', event.isFinal));
  });

  useSpeechRecognitionEvent('end', () => {
    if (phase !== 'listening') return;
    // Falls back to the live segment: ending capture mid-utterance is normal in
    // manual mode, and the engine does not always finalize what it heard.
    const message = transcriptRef.current.text().trim();
    if (!message) {
      resetToIdle();
      return;
    }
    setTranscript(message);
    void sendTranscript(message);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (phase !== 'listening') return;
    // "no-speech" is a normal outcome of an accidental tap.
    if (event.error !== 'no-speech') {
      addLog('Voice recognition error', 'WARNING', [event.error, event.message]);
      Toast.show({
        type: 'error',
        text1: t('voice.couldNotHear', { defaultValue: "Couldn't hear that" }),
        text2: event.message,
      });
    }
    resetToIdle();
  });

  const startListening = useCallback(async () => {
    stopSpeaking();
    const granted = await ensureVoicePermissions();
    if (!granted) {
      Toast.show({
        type: 'error',
        text1: t('voice.micPermissionTitle', {
          defaultValue: 'Microphone access needed',
        }),
        text2: t('voice.micPermissionMessage', {
          defaultValue: 'Enable the microphone and speech recognition in Settings.',
        }),
        onPress: () => Linking.openSettings(),
      });
      return;
    }
    sessionRef.current += 1;
    transcriptRef.current.reset();
    setTranscript('');
    setReply('');
    setErrorText('');
    setPhase('listening');
    try {
      startRecognition({ autoStop: voiceAutoStopEnabled });
    } catch (error) {
      addLog('Voice recognition failed to start', 'ERROR', [
        error instanceof Error ? error.message : String(error),
      ]);
      setPhase('idle');
    }
  }, [t, voiceAutoStopEnabled]);

  const handleMicPress = useCallback(() => {
    if (phase === 'listening') {
      // Second tap ends capture; the transcript + "end" event drive send.
      stopRecognition();
      return;
    }
    if (phase === 'thinking') return;
    void startListening();
  }, [phase, startListening]);

  const handleCancel = useCallback(() => {
    if (phase === 'listening') abortRecognition();
    resetToIdle();
  }, [phase, resetToIdle]);

  const openChat = useCallback(() => {
    resetToIdle();
    if (navigationRef.isReady()) navigationRef.navigate('Chat');
  }, [resetToIdle]);

  // End any in-flight capture if the button gets hidden (route change/setting).
  const hidden = !voiceButtonVisible || topRoute === null || VOICE_HIDDEN_ROUTES.has(topRoute);
  useEffect(() => {
    if (hidden && phase !== 'idle') {
      if (phase === 'listening') abortRecognition();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hiding mid-session must abort capture and settle the card back to idle
      resetToIdle();
    }
  }, [hidden, phase, resetToIdle]);

  if (hidden) return null;

  const onTabs = topRoute === 'Tabs';
  const bottom = insets.bottom + (onTabs ? 56 + 16 : 24) + workoutBarPadding;
  const cardOpen = phase !== 'idle';

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      {cardOpen && (
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: bottom + 64,
            backgroundColor: surface,
            borderColor: border,
            borderWidth: 1,
            borderRadius: 20,
            padding: 16,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Icon name="sparkles" size={16} color={accent} />
            <Text style={{ color: muted, fontSize: 13, marginLeft: 6, flex: 1 }}>
              {phase === 'listening' &&
                (voiceAutoStopEnabled
                  ? t('voice.listening', { defaultValue: 'Listening…' })
                  : t('voice.listeningManualStop', {
                      defaultValue: 'Listening… tap the mic when done',
                    }))}
              {phase === 'thinking' &&
                t('voice.thinking', { defaultValue: 'Sparky is working on it…' })}
              {phase === 'speaking' && t('voice.sparky', { defaultValue: 'Sparky' })}
              {phase === 'done' && t('voice.sparky', { defaultValue: 'Sparky' })}
              {phase === 'error' &&
                t('voice.errorTitle', { defaultValue: 'Something went wrong' })}
            </Text>
            <Pressable onPress={handleCancel} hitSlop={12} accessibilityLabel={t('voice.close', { defaultValue: 'Close voice card' })}>
              <Icon name="close" size={18} color={muted} />
            </Pressable>
          </View>

          {phase === 'listening' || phase === 'thinking' ? (
            <Text style={{ color: transcript ? textPrimary : muted, fontSize: 16 }}>
              {transcript ||
                t('voice.prompt', {
                  defaultValue: 'Say something like "log two eggs for breakfast".',
                })}
            </Text>
          ) : phase === 'error' ? (
            <Text style={{ color: dangerText, fontSize: 15 }}>{errorText}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 220 }}>
              <Text style={{ color: textPrimary, fontSize: 16 }}>{reply}</Text>
            </ScrollView>
          )}

          {(phase === 'done' || phase === 'speaking' || phase === 'error') && (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 12 }}>
              {phase === 'speaking' && (
                <Pressable
                  onPress={() => {
                    stopSpeaking();
                    setPhase('done');
                  }}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  accessibilityLabel={t('voice.stopSpeaking', {
                    defaultValue: 'Stop speaking',
                  })}
                >
                  <Icon name="speaker-off" size={16} color={muted} />
                  <Text style={{ color: muted, fontSize: 14 }}>
                    {t('voice.stop', { defaultValue: 'Stop' })}
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={openChat}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                accessibilityLabel={t('voice.openChatA11y', {
                  defaultValue: 'Open the full Sparky chat',
                })}
              >
                <Icon name="sparkles" size={16} color={accent} />
                <Text style={{ color: accent, fontSize: 14, fontWeight: '600' }}>
                  {t('voice.openChat', { defaultValue: 'Open chat' })}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={handleMicPress}
        accessibilityLabel={
          phase === 'listening'
            ? t('voice.stopListening', { defaultValue: 'Stop listening' })
            : t('voice.talkToSparky', { defaultValue: 'Talk to Sparky' })
        }
        style={{
          position: 'absolute',
          right: 16,
          bottom,
          width: 52,
          height: 52,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: phase === 'listening' ? dangerIcon : accent,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 6,
        }}
      >
        <Icon
          name={phase === 'listening' ? 'waveform' : phase === 'thinking' ? 'ellipsis-horizontal' : 'mic'}
          size={24}
          color="#ffffff"
        />
      </Pressable>
    </View>
  );
}
