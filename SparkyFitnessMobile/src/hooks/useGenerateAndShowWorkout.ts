import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useWorkoutRecommendation } from './useWorkoutRecommendation';
import type { GenerateRecommendationPayload } from '../services/api/workoutRecommendationsApi';
import type { RootStackParamList } from '../types/navigation';

type GenerateNavigation = Pick<
  NativeStackNavigationProp<RootStackParamList>,
  'navigate'
>;

interface UseGenerateAndShowWorkoutOptions {
  /**
   * Runs immediately before the screen navigates away on success — the seam
   * for a screen that guards its own departure (`PickMusclesScreen` blocks
   * `beforeRemove` while its grid is open and has to be told this one is ours).
   */
  onBeforeNavigate?: () => void;
}

/**
 * The shape shared by every picker that builds the next workout: guard the tap,
 * mark the row that is working, generate, and land on Up Next with the result.
 *
 * Extracted because the guards are the whole substance and each is easy to lose
 * in a copy. The in-flight ref is a ref and not the mutation's `isPending`
 * because `disabled` props follow a render and lose to a fast double-tap; the
 * mounted ref exists because leaving mid-request is legitimate — the workout
 * still lands in the recommendation cache Up Next reads — but pushing a screen
 * at someone who already backed out is not.
 *
 * The caller does not navigate: generation writes the fresh row into the shared
 * cache itself, so Up Next is current by the time we get there.
 */
export function useGenerateAndShowWorkout(
  navigation: GenerateNavigation,
  { onBeforeNavigate }: UseGenerateAndShowWorkoutOptions = {},
) {
  // Only the mutation is wanted: these screens do not render the stored
  // recommendation, so reading it would be a request for nothing.
  const { generateAsync } = useWorkoutRecommendation({ enabled: false });

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * @param key identifies the row that was tapped, so only it shows the wait.
   */
  const generateAndShow = useCallback(
    async (body: GenerateRecommendationPayload, key: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setPendingKey(key);
      try {
        await generateAsync(body);
        if (!isMountedRef.current) return;
        onBeforeNavigate?.();
        // `navigate` pops back to Up Next when the picker was opened from
        // there, and pushes it otherwise.
        navigation.navigate('UpNext');
      } catch {
        // The hook's onError already showed the failure toast; stay put so the
        // selection is not lost.
      } finally {
        inFlightRef.current = false;
        setPendingKey(null);
      }
    },
    [generateAsync, navigation, onBeforeNavigate],
  );

  return { generateAndShow, pendingKey, isGenerating: pendingKey !== null };
}
