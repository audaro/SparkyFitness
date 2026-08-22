import { useState } from 'react';
import {
  useMessage,
  useThread,
  useThreadRuntime,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import type { ProposeWorkoutPresetInput } from '@workspace/shared';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useCreateWorkoutPresetMutation,
  useDeleteWorkoutPresetMutation,
  useUpdateWorkoutPresetMutation,
  useFetchWorkoutPresetById,
} from '@/hooks/Exercises/useWorkoutPresets';
import WorkoutPresetForm from '@/pages/Exercises/WorkoutPresetForm';
import type { WorkoutPreset } from '@/types/workout';
import { formatWeight } from '@/utils/unitConversions';

// Seconds -> compact display ("45s", "2m", "1m 30s").
const formatSeconds = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
};

type ProposalState =
  | { phase: 'idle' }
  | { phase: 'accepted'; presetId: string };

/**
 * Renders the `sparky_propose_workout_preset` tool call as an interactive
 * routine card: the model proposes, and only the user's Accept commits — via
 * the same authenticated REST mutation the manual preset editor uses. The
 * client keeps the created id, so Undo and Edit stay reliable even though
 * tool results never reach the model (see
 * @workspace/shared/constants/chatProposals).
 */
export const WorkoutPresetProposalToolUI: ToolCallMessagePartComponent<
  ProposeWorkoutPresetInput
> = ({ args, toolCallId }) => {
  const { t } = useTranslation();
  const threadRuntime = useThreadRuntime();
  const isLast = useMessage((m) => m.isLast);
  const isRunning = useThread((th) => th.isRunning);
  const { user } = useAuth();
  const { weightUnit } = usePreferences();

  const { mutateAsync: createPreset, isPending: isCreating } =
    useCreateWorkoutPresetMutation();
  const { mutateAsync: deletePreset, isPending: isDeleting } =
    useDeleteWorkoutPresetMutation();
  const { mutateAsync: updatePreset } = useUpdateWorkoutPresetMutation();
  const fetchWorkoutPresetById = useFetchWorkoutPresetById();

  const [state, setState] = useState<ProposalState>({ phase: 'idle' });
  const [editPreset, setEditPreset] = useState<WorkoutPreset | null>(null);
  const [revisionText, setRevisionText] = useState('');
  const [showRevision, setShowRevision] = useState(false);

  // The tool input streams in as partial JSON — render nothing until the
  // proposal is complete enough to be a card (name + at least one exercise).
  const exercises = Array.isArray(args?.exercises) ? args.exercises : [];
  if (!args?.name || exercises.length === 0) return null;

  // Buttons on an older card would commit a stale proposal the chat has
  // moved past; a reloaded card also resets to idle, which matches the
  // quick-reply chips' behavior.
  const stale = !isLast || isRunning;

  const appendUserText = (text: string) => {
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text }],
    });
  };

  const handleAccept = async () => {
    if (!user?.id) return;
    // Commit shape = the manual editor's payload; the server's strip-mode
    // request schema drops display-only fields (exercise_name, modality)
    // and derives ownership from the session, so we can send them as-is.
    const payload = {
      name: args.name,
      description: args.description ?? undefined,
      is_public: false,
      user_id: user.id,
      exercises: exercises.map((ex, i) => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        sort_order: ex.sort_order ?? i,
        superset_group: ex.superset_group ?? null,
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map((set) => ({
          set_number: set.set_number,
          set_type: set.set_type ?? 'Working Set',
          reps: set.reps ?? null,
          weight: set.weight ?? null,
          duration: set.duration ?? null,
          distance: set.distance ?? null,
          rest_time: set.rest_time ?? null,
          notes: set.notes ?? null,
        })),
      })),
    };
    const created = await createPreset(
      payload as unknown as Omit<
        WorkoutPreset,
        'id' | 'created_at' | 'updated_at'
      >
    );
    setState({ phase: 'accepted', presetId: String(created.id) });
    appendUserText(
      t('workoutProposal.acceptedMessage', {
        defaultValue: 'I accepted the proposed routine "{{name}}".',
        name: args.name,
      })
    );
  };

  const handleUndo = async () => {
    if (state.phase !== 'accepted') return;
    await deletePreset(state.presetId);
    setState({ phase: 'idle' });
    appendUserText(
      t('workoutProposal.undoneMessage', {
        defaultValue: 'I undid the routine "{{name}}" — it was deleted.',
        name: args.name,
      })
    );
  };

  // Accept-then-Edit: the created preset is refetched by id so the form
  // seeds from the fully joined server shape (exercise objects included)
  // instead of the display-only proposal payload.
  const handleEdit = async () => {
    if (state.phase !== 'accepted') return;
    const preset = await fetchWorkoutPresetById(state.presetId);
    setEditPreset(preset);
  };

  const handleEditSave = async (
    updated: Omit<WorkoutPreset, 'id' | 'user_id' | 'created_at' | 'updated_at'>
  ) => {
    if (state.phase !== 'accepted') return;
    await updatePreset({ id: state.presetId, data: updated });
    setEditPreset(null);
  };

  const sendRevision = () => {
    const feedback = revisionText.trim();
    if (!feedback) return;
    setShowRevision(false);
    setRevisionText('');
    appendUserText(
      t('workoutProposal.reviseMessage', {
        defaultValue: 'Please revise the proposal: {{feedback}}',
        feedback,
      })
    );
  };

  const accepted = state.phase === 'accepted';
  const totalSets = exercises.reduce(
    (sum, ex) => sum + (Array.isArray(ex.sets) ? ex.sets.length : 0),
    0
  );

  return (
    <Card className="aui-workout-proposal-root my-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{args.name}</CardTitle>
          <Badge variant="secondary">
            {t('workoutProposal.proposalBadge', 'Proposed routine')}
          </Badge>
          {accepted && (
            <Badge>{t('workoutProposal.createdBadge', 'Created ✓')}</Badge>
          )}
        </div>
        {args.description && (
          <CardDescription>{args.description}</CardDescription>
        )}
        {args.rationale && (
          <p className="text-muted-foreground text-sm italic">
            {args.rationale}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {t('workoutProposal.summary', {
            defaultValue: '{{exercises}} exercises · {{sets}} sets',
            exercises: exercises.length,
            sets: totalSets,
          })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {exercises.map((ex, i) => (
          <div key={`${ex.exercise_id}-${i}`} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{ex.exercise_name}</span>
              {ex.superset_group !== null &&
                ex.superset_group !== undefined && (
                  <Badge variant="outline">
                    {t('workoutProposal.supersetBadge', {
                      defaultValue: 'Superset {{group}}',
                      group: ex.superset_group,
                    })}
                  </Badge>
                )}
            </div>
            {Array.isArray(ex.sets) && ex.sets.length > 0 && (
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8">
                        {t('workoutProposal.setColumn', 'Set')}
                      </TableHead>
                      <TableHead className="h-8">
                        {t('workoutProposal.typeColumn', 'Type')}
                      </TableHead>
                      <TableHead className="h-8">
                        {t('workoutProposal.repsColumn', 'Reps')}
                      </TableHead>
                      <TableHead className="h-8">
                        {t('workoutProposal.weightColumn', 'Weight')}
                      </TableHead>
                      <TableHead className="h-8">
                        {t('workoutProposal.durationColumn', 'Duration')}
                      </TableHead>
                      <TableHead className="h-8">
                        {t('workoutProposal.distanceColumn', 'Distance')}
                      </TableHead>
                      <TableHead className="h-8">
                        {t('workoutProposal.restColumn', 'Rest')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ex.sets.map((set) => (
                      <TableRow key={set.set_number}>
                        <TableCell className="py-1">{set.set_number}</TableCell>
                        <TableCell className="py-1">
                          {set.set_type ?? 'Working Set'}
                        </TableCell>
                        <TableCell className="py-1">
                          {set.reps ?? '—'}
                        </TableCell>
                        <TableCell className="py-1">
                          {set.weight !== null && set.weight !== undefined
                            ? formatWeight(set.weight, weightUnit)
                            : '—'}
                        </TableCell>
                        <TableCell className="py-1">
                          {set.duration !== null && set.duration !== undefined
                            ? formatSeconds(set.duration)
                            : '—'}
                        </TableCell>
                        <TableCell className="py-1">
                          {set.distance !== null && set.distance !== undefined
                            ? `${set.distance} km`
                            : '—'}
                        </TableCell>
                        <TableCell className="py-1">
                          {set.rest_time !== null && set.rest_time !== undefined
                            ? formatSeconds(set.rest_time)
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2">
        <div className="flex flex-wrap gap-2">
          {!accepted ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={stale || isCreating || !user?.id}
                onClick={handleAccept}
              >
                {isCreating
                  ? t('workoutProposal.accepting', 'Creating…')
                  : t('workoutProposal.accept', 'Accept')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={stale}
                onClick={() => setShowRevision((v) => !v)}
              >
                {t('workoutProposal.regenerate', 'Request changes')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleEdit}
              >
                {t('workoutProposal.edit', 'Edit')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isDeleting}
                onClick={handleUndo}
              >
                {isDeleting
                  ? t('workoutProposal.undoing', 'Undoing…')
                  : t('workoutProposal.undo', 'Undo')}
              </Button>
            </>
          )}
        </div>
        {showRevision && !accepted && (
          <div className="flex gap-2">
            <Input
              value={revisionText}
              onChange={(e) => setRevisionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendRevision();
              }}
              placeholder={t(
                'workoutProposal.revisionPlaceholder',
                'What should change? e.g. “less volume, no barbell work”'
              )}
              className="h-8 text-sm"
            />
            <Button
              type="button"
              size="sm"
              disabled={stale || !revisionText.trim()}
              onClick={sendRevision}
            >
              {t('workoutProposal.sendRevision', 'Send')}
            </Button>
          </div>
        )}
      </CardFooter>
      {editPreset && (
        <WorkoutPresetForm
          key={`${toolCallId}-${String(editPreset.id)}`}
          isOpen
          onClose={() => setEditPreset(null)}
          onSave={handleEditSave}
          initialPreset={editPreset}
        />
      )}
    </Card>
  );
};
