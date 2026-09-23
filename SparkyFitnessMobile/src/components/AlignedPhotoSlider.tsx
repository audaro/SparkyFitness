import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

/** How far one VoiceOver increment moves the divider, as a fraction. */
const STEP = 0.1;

interface Props {
  /** Data URI of the before frame. */
  before: string;
  /** Data URI of the after frame, already warped onto the before frame. */
  after: string;
  /** Width / height of the shared frame. */
  aspectRatio: number;
}

/**
 * Two aligned photos under a draggable divider.
 *
 * The whole point of the alignment is that these two frames differ only where
 * the body differs, so they are drawn at exactly one size and one position:
 * the after frame is clipped by a container whose width moves, never scaled or
 * offset itself. Sizing or positioning the two layers independently would draw
 * a difference the photos do not contain, which is the failure this feature
 * exists to prevent.
 *
 * Dragging is not the only way to move it. A divider a screen reader user
 * cannot move is a picture they can only ever see half of, so the frame is an
 * `adjustable` element with increment/decrement actions and a value that says
 * where the split currently is.
 */
const AlignedPhotoSlider: React.FC<Props> = ({
  before,
  after,
  aspectRatio,
}) => {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  // Mirrors the shared value for the accessibility label and the a11y actions,
  // which run on the JS thread and cannot read a worklet's value.
  const [fraction, setFraction] = useState(0.5);
  const [accentPrimary, surfaceColor] = useCSSVariable([
    '--color-accent-primary',
    '--color-surface',
  ]) as [string, string];

  const split = useSharedValue(0);
  const startSplit = useSharedValue(0);

  const onLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      const next = event.nativeEvent.layout.width;
      setWidth(next);
      // Re-anchor rather than rescale: on the first layout there is no previous
      // width to scale from, and a rotation should leave the split where the
      // user put it proportionally.
      split.value = next * fraction;
    },
    [fraction, split]
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      startSplit.value = split.value;
    })
    .onUpdate((event) => {
      // Clamped inline rather than through a helper: this body runs on the UI
      // thread, and calling a plain JS function from it throws at runtime
      // rather than at build time.
      split.value = Math.min(
        Math.max(startSplit.value + event.translationX, 0),
        width
      );
    })
    .onEnd(() => {
      runOnJS(setFraction)(width > 0 ? split.value / width : 0.5);
    });

  const clipStyle = useAnimatedStyle(() => ({ width: split.value }));
  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: split.value }],
  }));

  const nudge = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(fraction + delta, 0), 1);
      setFraction(next);
      split.value = width * next;
    },
    [fraction, split, width]
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') nudge(STEP);
      if (event.nativeEvent.actionName === 'decrement') nudge(-STEP);
    },
    [nudge]
  );

  const percent = Math.round(fraction * 100);

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={onLayout}
        style={{ aspectRatio }}
        className="w-full bg-raised rounded-xl overflow-hidden"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('progressPhotos.aligned.sliderA11y', {
          defaultValue:
            'Before and after, aligned. Swipe up or down to move the divider.',
        })}
        accessibilityValue={{
          min: 0,
          max: 100,
          now: percent,
          text: t('progressPhotos.aligned.sliderValueA11y', {
            defaultValue: '{{percent}}% before',
            percent,
          }),
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
      >
        <Image
          source={{ uri: after }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
        {/* The before frame on top, revealed from the left. `width` on the
            clip and a fixed width on the image inside it: an image that
            stretched with its container would change shape as the divider
            moved, which is a change in the photo that is not in the body. */}
        <Animated.View
          style={[
            { position: 'absolute', top: 0, left: 0, bottom: 0 },
            clipStyle,
          ]}
          className="overflow-hidden"
        >
          <Image
            source={{ uri: before }}
            style={{ width, height: '100%' }}
            contentFit="cover"
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: -1,
              width: 2,
              backgroundColor: surfaceColor,
            },
            handleStyle,
          ]}
        >
          <View
            style={{
              position: 'absolute',
              top: '50%',
              left: -15,
              width: 32,
              height: 32,
              marginTop: -16,
              borderRadius: 16,
              borderWidth: 2,
              borderColor: surfaceColor,
              backgroundColor: accentPrimary,
            }}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

export default AlignedPhotoSlider;
