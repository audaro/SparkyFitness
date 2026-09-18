import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import PagerView from 'react-native-pager-view';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useReducedMotion } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import ExerciseImageCrossfade, {
  sourceMayHaveTransparency,
} from './ExerciseImageCrossfade';
import Icon from './Icon';
import SafeImage from './SafeImage';
import {
  useExerciseImageSource,
  useImagePairAspectMatch,
} from '../hooks/useExerciseImageSource';
import type { Exercise } from '../types/exercise';
import { CATEGORY_ICON_MAP } from '../utils/workoutSession';

// Matches the dominant exercise image sets (4:3 photos), so cover-filled
// frames crop little to nothing.
export const IMAGE_ASPECT_RATIO = 4 / 3;

// Demonstration clips are landscape 16:9 (the Fitbod catalog ships 1280x720),
// so the video hero keeps that frame instead of cropping to the photo ratio.
export const VIDEO_ASPECT_RATIO = 16 / 9;

/**
 * Whether this exercise has anything for the hero to show. Callers use it to
 * decide whether a media-only tab or section is worth offering at all — the
 * component itself renders `null` in the same case, so the two agree.
 */
export function exerciseHasHeroMedia(exercise: Exercise): boolean {
  return (
    (exercise.images?.some(Boolean) ?? false) ||
    (exercise.videos?.some(Boolean) ?? false)
  );
}

interface ExerciseHeroMediaProps {
  exercise: Exercise;
}

/**
 * The demonstration hero: a looping clip when the catalog has one, otherwise
 * the photos — one still, a two-frame crossfade for the start/end pairs that
 * dominate free-exercise-db, or a swipeable pager with dots beyond that.
 *
 * Shared by `ExerciseDetailScreen` and `ExerciseSheetScreen` rather than
 * copied: the branch order encodes which catalogs ship what, and two copies of
 * that would drift the moment one of them gained a source.
 *
 * Reduced motion shows the still photo instead of the clip, and a screen
 * pushed over this one pauses the loop rather than decoding under the cover.
 * Page state lives here, so remounting the hero (a tab switch that renders it
 * in a different slot) resets the dots without the caller arranging it.
 */
function ExerciseHeroMedia({ exercise }: ExerciseHeroMediaProps) {
  const { getImageSource } = useExerciseImageSource();
  const reducedMotion = useReducedMotion();
  const isFocused = useIsFocused();
  const [textMuted] = useCSSVariable(['--color-text-muted']) as [string];
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const imageSources = useMemo(() => {
    return (exercise.images ?? [])
      .map((path) => (path ? getImageSource(path) : null))
      .filter(
        (source): source is { uri: string; headers: Record<string, string> } =>
          source !== null
      );
  }, [exercise.images, getImageSource]);

  const pairAspectMatch = useImagePairAspectMatch(imageSources);

  // First clip only: a looping, muted demonstration is a hero, not a gallery.
  // The hook must run every render, so it takes `null` when there is no clip.
  const videoSource = useMemo(() => {
    const path = exercise.videos?.find((candidate) => Boolean(candidate));
    return path ? getImageSource(path) : null;
  }, [exercise.videos, getImageSource]);

  const videoPlayer = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
    player.muted = true;
  });
  useEffect(() => {
    if (!videoSource) return;
    if (isFocused && !reducedMotion) {
      videoPlayer.play();
    } else {
      videoPlayer.pause();
    }
  }, [isFocused, reducedMotion, videoPlayer, videoSource]);

  const handleImagePageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setActiveImageIndex(e.nativeEvent.position);
    },
    []
  );

  const imageFallback = (
    <View className="bg-raised items-center justify-center" style={{ flex: 1 }}>
      <Icon
        name={
          (exercise.category && CATEGORY_ICON_MAP[exercise.category]) ||
          'exercise-weights'
        }
        size={48}
        color={textMuted}
      />
    </View>
  );

  if (videoSource && !reducedMotion) {
    return (
      <View className="bg-surface rounded-xl overflow-hidden">
        <VideoView
          player={videoPlayer}
          style={{ width: '100%', aspectRatio: VIDEO_ASPECT_RATIO }}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          accessibilityLabel={exercise.name}
        />
      </View>
    );
  }

  if (imageSources.length === 1) {
    const transparent = sourceMayHaveTransparency(imageSources[0].uri);
    return (
      <View
        className={`${transparent ? 'bg-white' : 'bg-surface'} rounded-xl overflow-hidden`}
      >
        <SafeImage
          source={imageSources[0]}
          style={{ width: '100%', aspectRatio: IMAGE_ASPECT_RATIO }}
          contentFit={transparent ? 'contain' : 'cover'}
          fallback={imageFallback}
          autoplay={!reducedMotion}
        />
      </View>
    );
  }

  if (
    imageSources.length === 2 &&
    !reducedMotion &&
    pairAspectMatch !== false
  ) {
    return (
      <View
        className="bg-surface rounded-xl overflow-hidden"
        style={{ width: '100%', aspectRatio: IMAGE_ASPECT_RATIO }}
      >
        <ExerciseImageCrossfade
          sources={[imageSources[0], imageSources[1]]}
          fallback={imageFallback}
        />
      </View>
    );
  }

  if (imageSources.length > 1) {
    return (
      <View>
        <View
          className="bg-surface rounded-xl overflow-hidden"
          style={{ width: '100%', aspectRatio: IMAGE_ASPECT_RATIO }}
        >
          <PagerView
            style={{ flex: 1 }}
            initialPage={0}
            onPageSelected={handleImagePageSelected}
          >
            {imageSources.map((source, index) => (
              <View
                key={`${source.uri}-${index}`}
                className={
                  sourceMayHaveTransparency(source.uri) ? 'bg-white' : undefined
                }
              >
                <SafeImage
                  source={source}
                  style={{ width: '100%', height: '100%' }}
                  contentFit={
                    sourceMayHaveTransparency(source.uri) ? 'contain' : 'cover'
                  }
                  fallback={imageFallback}
                  autoplay={!reducedMotion}
                />
              </View>
            ))}
          </PagerView>
        </View>
        <View className="flex-row justify-center items-center mt-2">
          {imageSources.map((source, index) => (
            <View
              key={`dot-${source.uri}-${index}`}
              className={`w-2 h-2 rounded-full mx-1 ${
                index === activeImageIndex ? 'bg-accent-primary' : 'bg-border'
              }`}
            />
          ))}
        </View>
      </View>
    );
  }

  return null;
}

export default React.memo(ExerciseHeroMedia);
