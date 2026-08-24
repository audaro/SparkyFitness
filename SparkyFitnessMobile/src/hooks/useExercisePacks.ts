import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import {
  fetchExercisePacks,
  importExercisePackBatch,
  type ExercisePack,
} from '../services/api/exercisePacksApi';
import { exercisePacksQueryKey } from './queryKeys';

/** Exercises per request. The server caps batches at this size. */
const BATCH_SIZE = 10;

export interface PackImportProgress {
  packId: string;
  /** How many of the pack's exercises have been walked so far. */
  processed: number;
  total: number;
  imported: number;
  skipped: number;
  failures: { name: string; reason: string }[];
}

export function useExercisePacks() {
  const query = useQuery<ExercisePack[]>({
    queryKey: exercisePacksQueryKey,
    queryFn: fetchExercisePacks,
  });

  return {
    packs: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Walks a pack import batch by batch, surfacing progress as it goes.
 *
 * The loop is driven here rather than server-side because each batch is a
 * handful of image downloads: one request for the whole pack would outlive the
 * client's timeout, and a fire-and-forget job would need somewhere to report
 * progress back to. Import is idempotent, so an interrupted run simply resumes
 * from wherever it stopped the next time it is started.
 */
export function useExercisePackImport() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PackImportProgress | null>(null);
  // State, not just the ref, because the screen re-renders off this.
  const [isImporting, setIsImporting] = useState(false);
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);

  // A run that outlives the screen has nowhere to report to, and the user has
  // signalled they are done with it by leaving.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const importPack = useCallback(
    async (pack: ExercisePack) => {
      if (runningRef.current) return;
      runningRef.current = true;
      cancelledRef.current = false;
      setIsImporting(true);

      let offset = 0;
      let imported = 0;
      let skipped = 0;
      const failures: { name: string; reason: string }[] = [];
      setProgress({
        packId: pack.id,
        processed: 0,
        total: pack.total,
        imported: 0,
        skipped: 0,
        failures: [],
      });

      try {
        for (;;) {
          if (cancelledRef.current) break;
          const batch = await importExercisePackBatch(
            pack.id,
            offset,
            BATCH_SIZE,
          );
          imported += batch.imported;
          skipped += batch.skipped;
          failures.push(...batch.failures);
          setProgress({
            packId: pack.id,
            processed: batch.processed,
            total: batch.total,
            imported,
            skipped,
            failures: [...failures],
          });
          if (batch.done || batch.nextOffset === null) break;
          offset = batch.nextOffset;
        }

        if (imported > 0) {
          // Every exercise list is cached with an infinite stale time, so a
          // fresh import is invisible until these are dropped.
          await queryClient.resetQueries({ queryKey: ['exercisesLibrary'] });
          await queryClient.invalidateQueries({ queryKey: ['exerciseSearch'] });
          await queryClient.invalidateQueries({
            queryKey: exercisePacksQueryKey,
          });
        }

        if (!cancelledRef.current) {
          Toast.show({
            type: failures.length > 0 ? 'error' : 'success',
            text1:
              imported > 0
                ? `Added ${imported} exercise${imported === 1 ? '' : 's'}`
                : 'Nothing new to add',
            text2:
              failures.length > 0
                ? `${failures.length} could not be added.`
                : skipped > 0
                  ? `${skipped} were already in your library.`
                  : undefined,
          });
        }
      } catch (error) {
        Toast.show({
          type: 'error',
          text1: 'Import stopped',
          text2:
            error instanceof Error
              ? error.message
              : 'Please check your connection and try again.',
        });
      } finally {
        runningRef.current = false;
        setIsImporting(false);
      }
    },
    [queryClient],
  );

  return { progress, isImporting, importPack, cancel };
}
