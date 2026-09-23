import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import SafeImage from '../components/SafeImage';
import {
  useCheckInPhotoGallery,
  useCheckInPhotoMutations,
} from '../hooks/useCheckInPhotos';
import { useCheckInPhotoSource } from '../hooks/useCheckInPhotoSource';
import { getApiErrorMessage } from '../services/api/errors';
import { downscale } from '../utils/pickImage';
import { buildCaptureMeta } from '../utils/captureMeta';
import { getPhotoAngleLabel } from '../utils/photoAngleLabel';
import { formatShortDate } from '../utils/dateUtils';
import i18n from '../localization/i18n';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'ProgressPhotoCapture'>;

/**
 * Opacities the ghost cycles through.
 *
 * Three fixed stops rather than a slider: the useful range is narrow (too faint
 * to align against, too solid to see yourself through) and a stop is one tap
 * while you are standing in frame, where dragging a thumb is not.
 */
const GHOST_OPACITIES = [0.25, 0.4, 0.6] as const;

/** Self-timer stops, in seconds. 0 fires the shutter immediately. */
const TIMER_STOPS = [0, 3, 10] as const;

/**
 * Guided capture: frame this shoot against the last one.
 *
 * The comparison that comes later is only worth as much as the pair's
 * consistency, and consistency is won here, at the shutter, not in
 * post-processing — no amount of alignment rescues a photo taken from a
 * different height in different light. So this screen does three things the
 * system camera cannot: it ghosts the previous photo of the same angle under
 * the viewfinder to frame against, it runs a self-timer so the phone can sit on
 * a shelf while you step into position, and it records what it knew at the
 * shutter (`capture_meta`) so a later comparison can say how comparable the two
 * shots actually are instead of guessing.
 *
 * The system-camera and library paths on {@link ProgressPhotosScreen} stay
 * exactly as they were; this is an additional way in, not a replacement.
 */
const ProgressPhotoCaptureScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { date, angle } = route.params;
  const dateLocale = i18n.language.startsWith('pl') ? 'pl-PL' : 'en-US';

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // Front by default: the ghost is only useful if you can see it while you
  // stand in frame, and that means the camera facing you.
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [opacityIndex, setOpacityIndex] = useState(1);
  const [timerIndex, setTimerIndex] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const { days, isLoading: galleryLoading } = useCheckInPhotoGallery();
  const { getPhotoSource } = useCheckInPhotoSource();
  const { uploadAsync } = useCheckInPhotoMutations();

  const ghostOpacity = GHOST_OPACITIES[opacityIndex];
  const timerSeconds = TIMER_STOPS[timerIndex];

  /**
   * The photo to frame against: the most recent shoot of this angle that is not
   * the day being captured.
   *
   * Excluding today matters when replacing a shot taken an hour ago — ghosting
   * the photo you are about to overwrite would align this attempt to the
   * mistake rather than to the series.
   */
  const reference = useMemo(() => {
    for (const day of days) {
      if (day.entry_date === date) continue;
      const photo = day.photos[angle];
      if (photo) return { id: photo.id, entry_date: day.entry_date };
    }
    return null;
  }, [days, date, angle]);

  const referenceSource = useMemo(
    () => (reference ? getPhotoSource(reference.id) : null),
    [reference, getPhotoSource]
  );

  /**
   * Whether the ghost has painted. The shutter waits on this, and on the
   * gallery answering at all: both are still resolving for the first frames
   * after this screen opens, and a shot fired in that window is framed against
   * an empty overlay while the metadata claims it lined up with a photo. The
   * whole point of recording the conditions is that they are true.
   *
   * A ghost that fails every retry settles too, as 'failed' - otherwise an
   * unreachable reference photo would disable the shutter for good, which is
   * worse than shooting without one. That case draws the crosshairs and
   * records no reference, exactly like a first shot.
   */
  const [ghostState, setGhostState] = useState<'pending' | 'shown' | 'failed'>(
    'pending'
  );
  // Reset during render rather than in an effect, so the first frame after the
  // reference changes already reads as pending instead of inheriting the
  // previous photo's settled state. Same pattern SafeImage uses internally.
  const [ghostPhotoId, setGhostPhotoId] = useState(reference?.id ?? null);
  if ((reference?.id ?? null) !== ghostPhotoId) {
    setGhostPhotoId(reference?.id ?? null);
    setGhostState('pending');
  }

  const ghostShown = reference !== null && ghostState === 'shown';
  const referenceReady =
    !galleryLoading && (reference === null || ghostState !== 'pending');

  const angleLabel = getPhotoAngleLabel(angle, t);

  const capture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!shot?.uri) return;
      // Same downscale the picker path applies: a raw camera frame is HEIC on
      // iOS and can exceed the server's 10 MB limit.
      let uri = shot.uri;
      try {
        uri = (await downscale(shot)).uri;
      } catch {
        // A failed re-encode should not lose the shot; the original still
        // uploads when it is within limits.
      }
      await uploadAsync({
        date,
        type: angle,
        uri,
        captureMeta: buildCaptureMeta({
          mode: 'guided',
          facing,
          // Both fields describe what was on screen, so they are reported
          // only when the ghost had actually painted. A reference that was
          // still loading, or failed to load, framed nothing.
          referencePhotoId: reference && ghostShown ? reference.id : null,
          ...(ghostShown ? { referenceOpacity: ghostOpacity } : {}),
          timerSeconds,
        }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: t('progressPhotos.uploadError', {
          defaultValue: 'Could not save that photo',
        }),
        text2: getApiErrorMessage(err) ?? undefined,
      });
    } finally {
      setIsCapturing(false);
    }
  }, [
    isCapturing,
    uploadAsync,
    date,
    angle,
    facing,
    reference,
    ghostShown,
    ghostOpacity,
    timerSeconds,
    navigation,
    t,
  ]);

  // The countdown lives in state so the number on screen and the shutter fire
  // off the same tick. Cleared on unmount so a backgrounded screen cannot take
  // a photo after the user has left it.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void capture();
      return;
    }
    const id = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, capture]);

  const onShutter = useCallback(() => {
    if (isCapturing || countdown !== null || !referenceReady) return;
    void Haptics.selectionAsync();
    if (timerSeconds === 0) {
      void capture();
      return;
    }
    setCountdown(timerSeconds);
  }, [isCapturing, countdown, referenceReady, timerSeconds, capture]);

  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-black px-8">
        <Text className="text-center text-base text-white">
          {t('progressPhotos.capture.permission', {
            defaultValue: 'We need your permission to show the camera',
          })}
        </Text>
        <TouchableOpacity
          className="rounded-full bg-white px-6 py-3"
          onPress={() => void requestPermission()}
        >
          <Text className="text-base font-semibold text-black">
            {t('progressPhotos.capture.grantPermission', {
              defaultValue: 'Grant permission',
            })}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      {referenceSource && ghostState !== 'failed' ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <SafeImage
            source={referenceSource}
            contentFit="contain"
            onSettled={(visible) => setGhostState(visible ? 'shown' : 'failed')}
            style={[
              StyleSheet.absoluteFill,
              { opacity: ghostOpacity },
              // The front-camera preview is mirrored, while the stored photo is
              // not. Un-mirrored, the ghost's left arm sits over your right one
              // and framing against it means framing backwards, so flip the
              // ghost to match whatever the viewfinder is showing.
              facing === 'front' ? { transform: [{ scaleX: -1 }] } : null,
            ]}
          />
        </View>
      ) : (
        // Nothing to frame against - a first shot, or a reference that could
        // not be loaded - so give it something to be square with instead;
        // every later shoot in this angle inherits its framing.
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          className="items-center justify-center"
        >
          <View className="absolute h-full w-px bg-white/30" />
          <View className="absolute h-px w-full bg-white/30" />
        </View>
      )}

      {countdown !== null ? (
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          className="items-center justify-center"
        >
          <Text className="text-8xl font-bold text-white">{countdown}</Text>
        </View>
      ) : null}

      <View
        style={{ paddingTop: insets.top + 8 }}
        className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4"
      >
        <TouchableOpacity
          className="rounded-full bg-black/50 p-2"
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
        >
          <Icon name="close" size={22} color="#fff" />
        </TouchableOpacity>
        <View className="items-center">
          <Text className="text-sm font-semibold text-white">{angleLabel}</Text>
          <Text className="text-xs text-white/70">
            {formatShortDate(date, dateLocale)}
          </Text>
        </View>
        <TouchableOpacity
          className="rounded-full bg-black/50 p-2"
          onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
          accessibilityRole="button"
          accessibilityLabel={t('progressPhotos.capture.flipCamera', {
            defaultValue: 'Flip camera',
          })}
        >
          <Icon name="camera-reverse" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View
        style={{ paddingBottom: insets.bottom + 16 }}
        className="absolute bottom-0 left-0 right-0 gap-4 px-6"
      >
        <Text className="text-center text-xs text-white/70">
          {!referenceReady
            ? t('progressPhotos.capture.loadingReference', {
                defaultValue: 'Finding your last shot at this angle…',
              })
            : reference
              ? t('progressPhotos.capture.ghostHint', {
                  defaultValue: 'Line yourself up with the photo from {{date}}',
                  date: formatShortDate(reference.entry_date, dateLocale),
                })
              : t('progressPhotos.capture.firstShotHint', {
                  defaultValue:
                    'Your first shot at this angle — every later one lines up with it, so stand square and leave room above and below.',
                })}
        </Text>

        {/*
          Not decoration. The waist and hip are measured by reading across the
          silhouette, and a silhouette cannot tell an arm from the torso it is
          resting against — an arm held against the body moved those numbers by
          5-6% between two photos of a body that had not changed at all, purely
          with how far the arm hung into the row. Arms clear of the sides is
          the one thing the person can do that makes those measurements mean
          anything, so it is said on every shot rather than buried in help.
        */}
        <Text className="text-center text-xs text-white/70">
          {t('progressPhotos.capture.armsHint', {
            defaultValue:
              'Hold your arms slightly away from your sides, or the waist and hip measurements follow your arms instead of you.',
          })}
        </Text>

        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            className="rounded-full bg-black/50 px-4 py-2"
            disabled={!reference}
            onPress={() =>
              setOpacityIndex((i) => (i + 1) % GHOST_OPACITIES.length)
            }
            accessibilityRole="button"
            accessibilityLabel={t('progressPhotos.capture.ghostOpacity', {
              defaultValue: 'Ghost opacity',
            })}
          >
            <Text
              className={
                reference
                  ? 'text-sm font-semibold text-white'
                  : 'text-sm font-semibold text-white/30'
              }
            >
              {t('progressPhotos.capture.ghostOpacityValue', {
                defaultValue: '{{percent}}%',
                percent: Math.round(ghostOpacity * 100),
              })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20"
            onPress={onShutter}
            disabled={isCapturing || countdown !== null || !referenceReady}
            accessibilityRole="button"
            accessibilityLabel={t('progressPhotos.capture.shutter', {
              defaultValue: 'Take photo',
            })}
          >
            {isCapturing || !referenceReady ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View className="h-16 w-16 rounded-full bg-white" />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="rounded-full bg-black/50 px-4 py-2"
            onPress={() => setTimerIndex((i) => (i + 1) % TIMER_STOPS.length)}
            accessibilityRole="button"
            accessibilityLabel={t('progressPhotos.capture.timer', {
              defaultValue: 'Self-timer',
            })}
          >
            <Text className="text-sm font-semibold text-white">
              {timerSeconds === 0
                ? t('progressPhotos.capture.timerOff', { defaultValue: 'Off' })
                : t('progressPhotos.capture.timerValue', {
                    defaultValue: '{{seconds}}s',
                    seconds: timerSeconds,
                  })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default ProgressPhotoCaptureScreen;
