import type { Exercise } from '../types/exercise';
import { useParamHandoff } from './useParamHandoff';

interface RouteParamsWithExercise {
  selectedExercise?: Exercise;
  selectionNonce?: number;
}

export function useSelectedExercise(
  params: RouteParamsWithExercise | undefined,
  onSelect: (exercise: Exercise) => void
): void {
  useParamHandoff(params?.selectedExercise, params?.selectionNonce, onSelect);
}
