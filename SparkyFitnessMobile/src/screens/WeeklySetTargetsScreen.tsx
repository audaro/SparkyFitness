import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Button from '../components/ui/Button';
import Icon from '../components/Icon';
import StatusView from '../components/StatusView';
import HexagonProgressRing from '../components/HexagonProgressRing';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useWeeklySetGroupColors } from '../hooks/useWeeklySetGroupColors';
import {
  useUpdateWeeklySetTargets,
  useWeeklySetTargets,
} from '../hooks/useWeeklySetTargets';
import { formatSetCount } from '../utils/workoutSession';
import type {
  MuscleGroup,
  WeeklySetGroupProgress,
  WeeklySetTargetSummary,
} from '../services/api/weeklySetTargetsApi';
import type { RootStackScreenProps } from '../types/navigation';

type WeeklySetTargetsScreenProps = RootStackScreenProps<'WeeklySetTargets'>;

const RING_SIZE = 240;
const RING_STROKE = 14;
/** Matches the server's ceiling on a hand-set target. */
const MAX_TARGET = 100;

const GROUP_LABELS: Record<MuscleGroup, string> = {
  push: 'Push Muscles',
  pull: 'Pull Muscles',
  legs: 'Leg Muscles',
  core: 'Core Muscles',
};

/** Which muscles land in each group, so the numbers are not a black box. */
const GROUP_DETAIL: Record<MuscleGroup, string> = {
  push: 'Chest, shoulders, triceps',
  pull: 'Back, lats, traps, biceps, forearms',
  legs: 'Quads, hamstrings, glutes, calves',
  core: 'Abdominals',
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

function weekRangeLabel(summary: WeeklySetTargetSummary): string {
  return `${formatDay(summary.week_start)} – ${formatDay(summary.week_end)}`;
}

const WeeklySetTargetsScreen: React.FC<WeeklySetTargetsScreenProps> = () => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const { data, isLoading, isError, refetch } = useWeeklySetTargets();
  const updateTargets = useUpdateWeeklySetTargets();
  const [editingGroup, setEditingGroup] = useState<MuscleGroup | null>(null);
  const [draftTarget, setDraftTarget] = useState(0);

  const header = useScreenHeader({
    title: 'Weekly Set Targets',
    left: { kind: 'back' },
  });

  const trackColor = useCSSVariable('--color-progress-track') as string;
  const mutedColor = useCSSVariable('--color-text-muted') as string;
  const primaryTextColor = useCSSVariable('--color-text-primary') as string;

  const groupColors = useWeeklySetGroupColors();

  // Left to the React Compiler rather than useMemo: it declines to preserve a
  // manual memo here, and a rejected memo is worse than none.
  const segments = (data?.current.groups ?? []).map((group) => ({
    percent: group.percent,
    color: groupColors[group.group],
  }));

  const commitEdit = () => {
    if (!editingGroup) return;
    const original = data?.current.groups.find((g) => g.group === editingGroup);
    setEditingGroup(null);
    // Nothing to save when the number did not move; the request would still
    // flip targets_are_custom and claim the derived default as a choice.
    if (!original || original.target === draftTarget) return;
    updateTargets.mutate({ [editingGroup]: draftTarget });
  };

  const startEditing = (group: WeeklySetGroupProgress) => {
    // Opening a second group must not drop the first one's edit on the floor.
    if (editingGroup && editingGroup !== group.group) commitEdit();
    setEditingGroup(group.group);
    setDraftTarget(group.target);
  };

  const adjustDraft = useCallback((delta: number) => {
    setDraftTarget((current) =>
      Math.max(0, Math.min(MAX_TARGET, current + delta)),
    );
  }, []);

  if (isLoading) {
    return (
      <View
        className="flex-1 bg-background"
        style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
      >
        {header}
        <StatusView loading title="Loading your week…" />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View
        className="flex-1 bg-background"
        style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
      >
        {header}
        <StatusView
          icon="alert-circle"
          iconTone="danger"
          title="Could not load your targets"
          subtitle="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void refetch() }}
        />
      </View>
    );
  }

  const overallPercentLabel = `${Math.round(data.current.overall_percent * 100)}%`;

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
      >
        <Text className="text-sm text-text-secondary">
          {weekRangeLabel(data.current)}
        </Text>

        <View className="my-6 items-center justify-center">
          <HexagonProgressRing
            size={RING_SIZE}
            strokeWidth={RING_STROKE}
            segments={segments}
            trackColor={trackColor}
          />
          <View
            className="absolute items-center"
            pointerEvents="none"
            testID="weekly-set-targets-overall"
          >
            <Text className="text-4xl font-bold italic text-text-primary">
              {overallPercentLabel}
            </Text>
          </View>
        </View>

        {!data.targets_are_custom ? (
          <Text className="mb-4 text-sm text-text-muted">
            These targets are a starting point based on how often you train.
            Tap any group to set your own.
          </Text>
        ) : null}

        {data.current.groups.map((group) => {
          const isEditing = editingGroup === group.group;
          return (
            <View
              key={group.group}
              className="mb-3 rounded-2xl bg-surface p-4"
              testID={`weekly-set-group-${group.group}`}
            >
              <Pressable
                className="flex-row items-center"
                onPress={() =>
                  isEditing ? commitEdit() : startEditing(group)
                }
                accessibilityRole="button"
                accessibilityLabel={`${GROUP_LABELS[group.group]}, ${formatSetCount(group.completed)} of ${group.target} sets`}
                testID={`weekly-set-group-toggle-${group.group}`}
              >
                <View
                  className="mr-3 h-6 w-6 rounded-md"
                  style={{ backgroundColor: groupColors[group.group] }}
                />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-text-primary">
                    {GROUP_LABELS[group.group]}
                  </Text>
                  <Text className="mt-0.5 text-sm text-text-secondary">
                    {formatSetCount(group.completed)} / {group.target} Sets
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-base font-semibold text-text-primary">
                    {group.target === 0
                      ? '—'
                      : formatSetCount(group.remaining)}
                  </Text>
                  <Text className="text-xs text-text-muted">
                    {group.target === 0 ? 'not tracked' : 'to go'}
                  </Text>
                </View>
                <Icon
                  name={isEditing ? 'chevron-down' : 'chevron-forward'}
                  size={18}
                  color={mutedColor}
                  style={{ marginLeft: 8 }}
                />
              </Pressable>

              {isEditing ? (
                <View className="mt-4 border-t border-border pt-4">
                  <Text className="mb-3 text-sm text-text-secondary">
                    {GROUP_DETAIL[group.group]}
                  </Text>
                  <View className="flex-row items-center justify-between">
                    <Pressable
                      className="h-11 w-11 items-center justify-center rounded-full bg-background"
                      onPress={() => adjustDraft(-1)}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease target"
                      testID={`weekly-set-decrease-${group.group}`}
                    >
                      <Icon name="remove" size={20} color={primaryTextColor} />
                    </Pressable>
                    <View className="items-center">
                      <Text
                        className="text-2xl font-bold text-text-primary"
                        testID={`weekly-set-draft-${group.group}`}
                      >
                        {draftTarget}
                      </Text>
                      <Text className="text-xs text-text-muted">
                        sets per week
                      </Text>
                    </View>
                    <Pressable
                      className="h-11 w-11 items-center justify-center rounded-full bg-background"
                      onPress={() => adjustDraft(1)}
                      accessibilityRole="button"
                      accessibilityLabel="Increase target"
                      testID={`weekly-set-increase-${group.group}`}
                    >
                      <Icon name="add" size={20} color={primaryTextColor} />
                    </Pressable>
                  </View>
                  <Button
                    className="mt-4"
                    onPress={commitEdit}
                    accessibilityLabel={`Save ${GROUP_LABELS[group.group]} target`}
                    testID={`weekly-set-save-${group.group}`}
                  >
                    Done
                  </Button>
                </View>
              ) : null}
            </View>
          );
        })}

        {data.history.length > 0 ? (
          <View className="mt-4">
            <Text className="mb-3 text-base font-semibold text-text-primary">
              History
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[...data.history].reverse().map((week) => (
                <View
                  key={week.week_start}
                  className="mr-3 w-24 items-center rounded-2xl bg-surface p-3"
                  testID={`weekly-set-history-${week.week_start}`}
                >
                  <HexagonProgressRing
                    size={56}
                    strokeWidth={5}
                    segments={week.groups.map((group) => ({
                      percent: group.percent,
                      color: groupColors[group.group],
                    }))}
                    trackColor={trackColor}
                  />
                  <Text className="mt-2 text-sm font-semibold text-text-primary">
                    {Math.round(week.overall_percent * 100)}%
                  </Text>
                  <Text className="text-xs text-text-muted">
                    {formatDay(week.week_start)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default WeeklySetTargetsScreen;
