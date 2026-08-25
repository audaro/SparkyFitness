import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { formatSetCount } from '@workspace/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCoachingContextAvailable } from '@/hooks/Exercises/useCoachingContextAvailable';
import {
  useUpdateWeeklySetTargetsMutation,
  useWeeklySetTargets,
  type MuscleGroup,
  type WeeklySetTargets,
} from '@/hooks/Exercises/useWeeklySetTargets';

/** Matches the server's ceiling on a hand-set target. */
const MAX_TARGET = 100;

/**
 * One colour per training group, as static hex values like the rest of the
 * app's charts. Categorical, not semantic — no group is a warning.
 */
const GROUP_COLORS: Record<MuscleGroup, string> = {
  push: '#f97316', // orange-500
  pull: '#ec4899', // pink-500
  legs: '#14b8a6', // teal-500
  core: '#8b5cf6', // violet-500
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats a YYYY-MM-DD day string for display without going through Date,
 * which would reinterpret a calendar day as a UTC instant and can shift it a
 * day either side of midnight.
 */
function formatDay(day: string): string {
  const [, month, date] = day.split('-');
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return `${monthName} ${Number(date)}`;
}

interface EditorState {
  group: MuscleGroup;
  /** Held as a string so the field can be empty mid-edit. */
  value: string;
}

/**
 * This week's working sets per training group, against the user's targets.
 *
 * Counts are fractional on purpose — an exercise that trains a group as a
 * secondary mover contributes half a set — so they go through
 * `formatSetCount` and are never rounded.
 */
const WeeklySetTargetsCard: React.FC = () => {
  const { t } = useTranslation();
  const enabled = useCoachingContextAvailable();

  const { data, isLoading, isError } = useWeeklySetTargets(enabled);
  const { mutate: saveTargets, isPending: isSaving } =
    useUpdateWeeklySetTargetsMutation();

  const [editor, setEditor] = useState<EditorState | null>(null);

  const groupLabels: Record<MuscleGroup, string> = {
    push: t('weeklySetTargets.group.push', 'Push Muscles'),
    pull: t('weeklySetTargets.group.pull', 'Pull Muscles'),
    legs: t('weeklySetTargets.group.legs', 'Leg Muscles'),
    core: t('weeklySetTargets.group.core', 'Core Muscles'),
  };

  /** Which muscles land in each group, so the numbers are not a black box. */
  const groupDetails: Record<MuscleGroup, string> = {
    push: t('weeklySetTargets.detail.push', 'Chest, shoulders, triceps'),
    pull: t(
      'weeklySetTargets.detail.pull',
      'Back, lats, traps, biceps, forearms'
    ),
    legs: t(
      'weeklySetTargets.detail.legs',
      'Quads, hamstrings, glutes, calves'
    ),
    core: t('weeklySetTargets.detail.core', 'Abdominals'),
  };

  const commitEdit = (current: WeeklySetTargets) => {
    if (!editor) return;
    const original = current.current.groups.find(
      (group) => group.group === editor.group
    );
    const parsed = Number(editor.value);
    setEditor(null);
    if (!original) return;
    // An empty or non-numeric field is a cancel, not a save of 0 — the server
    // treats 0 as "not training this group", which is a real choice nobody
    // makes by clearing a box.
    if (editor.value.trim() === '' || !Number.isFinite(parsed)) return;
    const next = Math.max(0, Math.min(MAX_TARGET, Math.round(parsed)));
    // Nothing to save when the number did not move; the request would still
    // flip targets_are_custom and claim a derived default as a choice.
    if (next === original.target) return;
    saveTargets({ [editor.group]: next });
  };

  /**
   * Opening one group's editor while another is open commits the open one
   * first — clicking a second Edit is not the same gesture as clicking Cancel,
   * and silently dropping a number the user typed would be indistinguishable
   * from a save that failed.
   */
  const startEditing = (current: WeeklySetTargets, group: MuscleGroup) => {
    if (editor && editor.group !== group) commitEdit(current);
    setEditor({
      group,
      value: String(
        current.current.groups.find((entry) => entry.group === group)?.target ??
          0
      ),
    });
  };

  if (!enabled) {
    return null;
  }

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    // `isError` is also true when a refetch fails over cached data, so the
    // error state is gated on there being no week to show.
    if (isError && !data) {
      return (
        <p className="text-center text-gray-400 py-10 italic">
          {t(
            'weeklySetTargets.loadError',
            'Failed to load your weekly targets.'
          )}
        </p>
      );
    }

    if (!data) return null;

    const overallPercent = Math.round(data.current.overall_percent * 100);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {t('weeklySetTargets.weekRange', {
              start: formatDay(data.current.week_start),
              end: formatDay(data.current.week_end),
              defaultValue: '{{start}} – {{end}}',
            })}
          </span>
          <span
            className="text-3xl font-bold tracking-tight"
            data-testid="weekly-set-targets-overall"
          >
            {t('weeklySetTargets.percent', {
              percent: overallPercent,
              defaultValue: '{{percent}}%',
            })}
          </span>
        </div>

        {!data.targets_are_custom && (
          <p className="text-sm text-muted-foreground">
            {t(
              'weeklySetTargets.derivedNote',
              'These targets are a starting point based on how often you train. Edit any group to set your own.'
            )}
          </p>
        )}

        <ul className="space-y-3">
          {data.current.groups.map((group) => {
            const isEditing = editor?.group === group.group;
            const color = GROUP_COLORS[group.group];
            // Each group is credited only up to its own target, so a bar never
            // runs past its track when one group is overtrained.
            const barPercent = Math.round(group.percent * 100);
            return (
              <li key={group.group} className="rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <span
                    className="h-5 w-5 rounded-md shrink-0"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{groupLabels[group.group]}</p>
                    <p className="text-xs text-muted-foreground">
                      {groupDetails[group.group]}
                    </p>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={MAX_TARGET}
                        className="w-20"
                        autoFocus
                        value={editor.value}
                        aria-label={t('weeklySetTargets.targetInputLabel', {
                          group: groupLabels[group.group],
                          defaultValue: '{{group}} weekly set target',
                        })}
                        onChange={(event) =>
                          setEditor({
                            group: group.group,
                            value: event.target.value,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitEdit(data);
                          if (event.key === 'Escape') setEditor(null);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => commitEdit(data)}
                        disabled={isSaving}
                        aria-label={t('weeklySetTargets.saveTarget', 'Save')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditor(null)}
                        aria-label={t('weeklySetTargets.cancelEdit', 'Cancel')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {t('weeklySetTargets.progress', {
                            completed: formatSetCount(group.completed),
                            target: group.target,
                            defaultValue: '{{completed}} / {{target}} sets',
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {group.target === 0
                            ? t('weeklySetTargets.notTracked', 'Not tracked')
                            : t('weeklySetTargets.remaining', {
                                remaining: formatSetCount(group.remaining),
                                defaultValue: '{{remaining}} to go',
                              })}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => startEditing(data, group.group)}
                        aria-label={t('weeklySetTargets.editTarget', {
                          group: groupLabels[group.group],
                          defaultValue: 'Edit {{group}} target',
                        })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${barPercent}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {data.history.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">
              {t('weeklySetTargets.history', 'Recent weeks')}
            </p>
            {/* Newest first, so the week just gone sits next to the current
                one. The wire sends history oldest-first. */}
            <ul className="flex flex-wrap gap-2">
              {[...data.history].reverse().map((week) => (
                <li
                  key={week.week_start}
                  className="rounded-lg border px-3 py-2 text-center"
                >
                  <p className="text-sm font-semibold">
                    {t('weeklySetTargets.percent', {
                      percent: Math.round(week.overall_percent * 100),
                      defaultValue: '{{percent}}%',
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(week.week_start)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">
          {t('weeklySetTargets.cardTitle', 'This Week')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'weeklySetTargets.cardDescription',
            'Working sets per training group against your weekly targets.'
          )}
        </p>
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
    </Card>
  );
};

export default WeeklySetTargetsCard;
