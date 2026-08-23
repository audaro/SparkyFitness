import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  SectionList,
  FlatList,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { CommonActions } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Button from '../components/ui/Button';
import StatusView from '../components/StatusView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../components/Icon';
import SafeImage from '../components/SafeImage';
import SegmentedControl from '../components/SegmentedControl';
import {
  CATEGORY_ICON_MAP,
  exerciseFromExternalItem,
  titleCaseCanonical,
} from '../utils/workoutSession';
import { useExerciseImageSource } from '../hooks/useExerciseImageSource';
import { useExerciseAlternatives } from '../hooks/useWorkoutRecommendation';
import { useServerConnection, useExternalProviders, useSuggestedExercises, useExerciseSearch, useProfile } from '../hooks';
import {
  deriveShareStatus,
  filterByOwnership,
  ownershipFilterEmptyState,
  ownershipFilterHeaderMenu,
} from '../utils/shareStatus';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import ShareStatusBadge from '../components/ShareStatusBadge';
import { suggestedExercisesQueryKey } from '../hooks/queryKeys';
import { useExternalExerciseSearch } from '../hooks/useExternalExerciseSearch';
import { useNavigationActionGuard } from '../hooks/useNavigationActionGuard';
import { useScreenHeader } from '../hooks/useScreenHeader';
import {
  importExercise,
  isImportableExerciseSource,
} from '../services/api/externalExerciseSearchApi';
import { fetchExerciseById } from '../services/api/exerciseApi';
import { getApiErrorMessage } from '../services/api/errors';
import type { AlternativeExercise } from '@workspace/shared';
import type { Exercise } from '../types/exercise';
import type { ExternalExerciseItem } from '../types/externalExercises';
import type { RootStackScreenProps } from '../types/navigation';

type ExerciseSearchScreenProps = RootStackScreenProps<'ExerciseSearch'>;

type ExerciseSection = {
  title: string;
  data: Exercise[];
};

type TabKey = 'search' | 'online';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'online', label: 'Online' },
] as const;

const ExerciseSearchScreen: React.FC<ExerciseSearchScreenProps> = ({ navigation, route }) => {
  const { returnKey, suggestForExerciseId } = route.params;

  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [accentColor, textMuted, textSecondary, borderSubtle] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
    '--color-text-secondary',
    '--color-border-subtle',
  ]) as [string, string, string, string];
  const { isConnected } = useServerConnection();
  const { profile } = useProfile();
  const { getImageSource } = useExerciseImageSource();
  const { isNavigationLocked, runNavigationAction } = useNavigationActionGuard(navigation);

  const [activeTab, setActiveTab] = useState<TabKey>('search');
  const ownershipFilter = useAppPreferencesStore((s) => s.exerciseSearchOwnershipFilter);
  const setOwnershipFilter = useAppPreferencesStore((s) => s.setExerciseSearchOwnershipFilter);
  const [searchText, setSearchText] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  // The row currently being resolved into a full local Exercise — an online
  // import, or a suggested local row being fetched in full. Both block the list
  // the same way, so they share one piece of state.
  const [resolvingExerciseId, setResolvingExerciseId] = useState<string | null>(null);

  const { recentExercises, topExercises, isLoading: isSuggestedLoading, isError: isSuggestedError, refetch: refetchSuggested } = useSuggestedExercises();
  const { searchResults, isSearching, isSearchActive, isSearchError } = useExerciseSearch(searchText);
  // Only fetched when the screen was opened to replace something; from Add it
  // is disabled and costs nothing.
  const {
    alternatives,
    isLoading: isAlternativesLoading,
    isError: isAlternativesError,
  } = useExerciseAlternatives(suggestForExerciseId);

  const {
    providers,
    isLoading: isProvidersLoading,
    isError: isProvidersError,
    refetch: refetchProviders,
  } = useExternalProviders({
    enabled: isConnected && activeTab === 'online',
    category: 'exercise',
  });

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const hasUserSelectedProvider = useRef(false);

  const selectedProviderType = useMemo(
    () => providers.find((p) => p.id === selectedProvider)?.provider_type ?? '',
    [providers, selectedProvider],
  );

  const selectedProviderName = useMemo(
    () => providers.find((p) => p.id === selectedProvider)?.provider_name ?? '',
    [providers, selectedProvider],
  );

  const {
    searchResults: onlineSearchResults,
    isSearching: isOnlineSearching,
    isSearchActive: isOnlineSearchActive,
    isSearchError: isOnlineSearchError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useExternalExerciseSearch(searchText, selectedProviderType, {
    enabled: isConnected && activeTab === 'online' && selectedProvider !== null,
    providerId: selectedProvider ?? undefined,
  });

useEffect(() => {
    if (providers.length === 0) return;
    if (hasUserSelectedProvider.current && providers.some((p) => p.id === selectedProvider)) return;
    // Default the provider once the list loads; guarded by a ref tracking an
    // explicit user selection, which keeps this from moving to a render-time derive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedProvider(providers[0].id);
  }, [providers, selectedProvider]);

  // --- Selection handlers ---

  const handleSelectExercise = useCallback((exercise: Exercise) => {
    navigation.dispatch({
      ...CommonActions.setParams({ selectedExercise: exercise, selectionNonce: Date.now() }),
      source: returnKey,
    });
    navigation.goBack();
  }, [returnKey, navigation]);

  const selectionInFlightRef = useRef(false);
  const handleImportExercise = useCallback(async (item: ExternalExerciseItem) => {
    // `resolvingExerciseId` only disables the rows after a re-render; the ref
    // blocks a second tap landing before that.
    if (selectionInFlightRef.current) return;
    selectionInFlightRef.current = true;
    setResolvingExerciseId(item.id);
    try {
      const exercise = await importExercise(item.source, item.id);
      // The import succeeded server-side, so the library cache must reflect
      // it even when the selection is abandoned below.
      queryClient.invalidateQueries({ queryKey: suggestedExercisesQueryKey });
      // The import doesn't block the back swipe/button; selecting from an
      // unfocused route would dispatch to the form and pop it.
      if (navigation.isFocused()) {
        handleSelectExercise(exercise);
      }
    } catch (error) {
      // apiFetch already logs the failure; surface it so the tap isn't silent.
      Toast.show({
        type: 'error',
        text1: 'Failed to add exercise',
        text2: getApiErrorMessage(error) ?? undefined,
      });
    }
    // No `finally`: the react compiler can't lower it and would bail on the
    // whole component. Every path above falls through to this cleanup.
    selectionInFlightRef.current = false;
    setResolvingExerciseId(null);
  }, [queryClient, handleSelectExercise, navigation]);

  /**
   * Pick a suggested replacement.
   *
   * A local row is FETCHED rather than rebuilt from the ranked candidate: the
   * alternatives contract carries no category, modality or calories_per_hour,
   * and the caller snapshots whatever it is handed — a sparse exercise would
   * land in the live workout with no modality and a zero calorie rate.
   *
   * An external row is imported first, which is what gives it a local uuid.
   * The source is free-exercise-db by construction: it is the only catalog the
   * server reaches for when the local one is too thin.
   */
  const handleSelectSuggested = useCallback(async (item: AlternativeExercise) => {
    if (selectionInFlightRef.current) return;
    selectionInFlightRef.current = true;
    setResolvingExerciseId(item.exercise_id);
    try {
      const exercise =
        item.source === 'local'
          ? await fetchExerciseById(item.exercise_id)
          : await importExercise('free-exercise-db', item.exercise_id);
      if (item.source === 'external') {
        // Same reasoning as the online tab: the import landed server-side, so
        // the library cache must reflect it even if the selection is abandoned.
        queryClient.invalidateQueries({ queryKey: suggestedExercisesQueryKey });
      }
      if (navigation.isFocused()) {
        handleSelectExercise(exercise);
      }
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Failed to add exercise',
        text2: getApiErrorMessage(error) ?? undefined,
      });
    }
    // No `finally` — see the note in handleImportExercise.
    selectionInFlightRef.current = false;
    setResolvingExerciseId(null);
  }, [queryClient, handleSelectExercise, navigation]);

  const handlePreviewExercise = useCallback((item: Exercise) => {
    runNavigationAction(() => {
      navigation.navigate('ExerciseDetail', {
        item,
        hideWorkoutActions: true,
        selectionReturnKey: returnKey,
      });
    });
  }, [runNavigationAction, navigation, returnKey]);

  const handlePreviewExternalExercise = useCallback((item: ExternalExerciseItem) => {
    runNavigationAction(() => {
      navigation.navigate('ExerciseDetail', {
        item: exerciseFromExternalItem(item),
        hideWorkoutActions: true,
        // Only importable sources get the Add action; a nutritionix preview
        // is read-only because mobile has no import path for it.
        ...(isImportableExerciseSource(item.source)
          ? { selectionReturnKey: returnKey }
          : {}),
      });
    });
  }, [runNavigationAction, navigation, returnKey]);

  // --- Shared renderers ---

  // Row tap selects instantly (fast path); the thumbnail and trailing ⓘ open
  // the detail screen as a pre-add preview. All are sibling pressables —
  // nesting would leave the inner ones live while their parent is disabled
  // and invite mis-taps. The thumbnail is hidden from the accessibility tree
  // because it duplicates the labeled ⓘ action.
  const renderExerciseRow = useCallback(({ item }: { item: Exercise }) => {
    const image = item.images?.[0] ?? null;
    const fallbackIcon =
      (item.category && CATEGORY_ICON_MAP[item.category]) || 'exercise-weights';
    const status = deriveShareStatus(item.userId, item.sharedWithPublic, profile?.id);
    return (
      <View className="flex-row items-center border-b border-border-subtle">
        <TouchableOpacity
          className="pl-4 py-3"
          activeOpacity={0.7}
          accessible={false}
          testID="exercise-thumbnail"
          disabled={isNavigationLocked || resolvingExerciseId !== null}
          onPress={() => handlePreviewExercise(item)}
        >
          <SafeImage
            source={image ? getImageSource(image) : null}
            style={{ width: 44, height: 44, borderRadius: 8 }}
            fallback={
              <View
                className="bg-raised items-center justify-center"
                style={{ width: 44, height: 44, borderRadius: 8 }}
              >
                <Icon name={fallbackIcon} size={22} color={textMuted} />
              </View>
            }
          />
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 flex-row items-center pl-3 py-3"
          activeOpacity={0.7}
          // Selecting is synchronous and pops the screen, so an un-guarded row
          // would let a tap here land on top of a suggestion still resolving —
          // two selections racing for one slot. Suggested rows sit directly
          // above these in the same list, which makes that a normal mis-tap.
          disabled={resolvingExerciseId !== null}
          onPress={() => handleSelectExercise(item)}
        >
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-text-primary text-base font-medium flex-shrink" numberOfLines={1}>
                {item.name}
              </Text>
              <ShareStatusBadge status={status} />
            </View>
            {item.category && (
              <Text className="text-sm mt-0.5" style={{ color: textSecondary }}>
                {item.category}
              </Text>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          className="px-4 py-3"
          activeOpacity={0.7}
          hitSlop={8}
          disabled={isNavigationLocked || resolvingExerciseId !== null}
          accessibilityLabel="View exercise details"
          onPress={() => handlePreviewExercise(item)}
        >
          <Icon name="info-circle" size={22} color={accentColor} />
        </TouchableOpacity>
      </View>
    );
  }, [
    handleSelectExercise,
    handlePreviewExercise,
    isNavigationLocked,
    resolvingExerciseId,
    accentColor,
    textSecondary,
    textMuted,
    getImageSource,
    profile,
  ]);

  const filteredRecentExercises = useMemo(() => filterByOwnership(recentExercises, ownershipFilter, profile?.id), [recentExercises, ownershipFilter, profile?.id]);
  const filteredTopExercises = useMemo(() => filterByOwnership(topExercises, ownershipFilter, profile?.id), [topExercises, ownershipFilter, profile?.id]);
  const filteredSearchResults = useMemo(() => filterByOwnership(searchResults, ownershipFilter, profile?.id), [searchResults, ownershipFilter, profile?.id]);

  const sections = useMemo(() => {
    const allSections: ExerciseSection[] = [
      { title: 'Recent', data: filteredRecentExercises },
      { title: 'Popular', data: filteredTopExercises },
    ];
    return allSections.filter((section) => section.data.length > 0);
  }, [filteredRecentExercises, filteredTopExercises]);

  const renderSectionHeader = ({ section }: { section: ExerciseSection }) => (
    <View className="px-4 py-2 bg-background">
      <Text className="text-text-secondary text-sm font-semibold uppercase tracking-wider">
        {section.title}
      </Text>
    </View>
  );

  // --- Suggested replacements ---

  // Same row anatomy as the library rows, minus the ⓘ preview: a suggestion is
  // resolved (fetched, or imported) on tap, and there is nothing local to
  // preview until that lands.
  const renderSuggestedRow = useCallback((item: AlternativeExercise) => {
    const image = item.images[0] ?? null;
    const subtitle =
      item.source === 'external'
        ? 'Not in your library yet'
        : (item.equipment.map(titleCaseCanonical).join(', ') ||
           item.primary_muscles.map(titleCaseCanonical).join(', '));
    return (
      <TouchableOpacity
        key={`${item.source}-${item.exercise_id}`}
        className="flex-row items-center border-b border-border-subtle pl-4 pr-4 py-3"
        activeOpacity={0.7}
        disabled={resolvingExerciseId !== null}
        testID="suggested-exercise-row"
        onPress={() => void handleSelectSuggested(item)}
      >
        <SafeImage
          source={image ? getImageSource(image) : null}
          style={{ width: 44, height: 44, borderRadius: 8 }}
          fallback={
            <View
              className="bg-raised items-center justify-center"
              style={{ width: 44, height: 44, borderRadius: 8 }}
            >
              <Icon name="exercise-weights" size={22} color={textMuted} />
            </View>
          }
        />
        <View className="flex-1 ml-3">
          <Text className="text-text-primary text-base font-medium" numberOfLines={1}>
            {item.exercise_name}
          </Text>
          {subtitle.length > 0 && (
            <Text className="text-sm mt-0.5" style={{ color: textSecondary }} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {resolvingExerciseId === item.exercise_id && (
          <ActivityIndicator size="small" color={accentColor} />
        )}
      </TouchableOpacity>
    );
  }, [
    handleSelectSuggested,
    resolvingExerciseId,
    accentColor,
    textSecondary,
    textMuted,
    getImageSource,
  ]);

  /**
   * The "Suggested" block, rendered as a list header above both the idle
   * library sections and the search results — so a user who starts typing
   * scrolls past the shortlist rather than losing it.
   *
   * A failed or empty lookup renders nothing: the fallback for "no suggestions"
   * is the plain search this screen already is, not an error in place of it.
   */
  const suggestedSection = useMemo(() => {
    if (!suggestForExerciseId || isAlternativesError) return null;
    if (!isAlternativesLoading && alternatives.length === 0) return null;
    return (
      <View testID="suggested-section">
        <View className="px-4 py-2 bg-background">
          <Text className="text-text-secondary text-sm font-semibold uppercase tracking-wider">
            Suggested
          </Text>
        </View>
        {isAlternativesLoading ? (
          <View className="py-4 items-center">
            <ActivityIndicator size="small" color={accentColor} />
          </View>
        ) : (
          alternatives.map(renderSuggestedRow)
        )}
      </View>
    );
  }, [
    suggestForExerciseId,
    alternatives,
    isAlternativesLoading,
    isAlternativesError,
    renderSuggestedRow,
    accentColor,
  ]);

  const renderSearchBar = () => (
    <View className="px-4 py-2">
      <View
        className="flex-row items-center bg-raised rounded-lg px-3 py-2.5"
        style={{ borderWidth: 1, borderColor: isSearchFocused ? accentColor : borderSubtle }}
      >
        <Icon name="search" size={18} color={textMuted} />
        <View className="flex-1 ml-2">
          <TextInput
            className="text-text-primary"
            style={{ fontSize: 16, padding: 0, includeFontPadding: false }}
            placeholder="Search exercises..."
            placeholderTextColor={textMuted}
            value={searchText}
            onChangeText={setSearchText}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {searchText.length > 0 && (
          <Button variant="header" onPress={() => setSearchText('')} hitSlop={8}>
            <Icon name="close" size={16} color={textMuted} />
          </Button>
        )}
      </View>
    </View>
  );

  // --- Search tab ---

  /**
   * Why the results list is empty — loading, failed, filtered out, or no match.
   *
   * `inline` matters: StatusView's default container is `flex-1`, which
   * collapses to nothing inside a list's content container. As a whole-screen
   * return it needs the default; as a ListEmptyComponent it needs inline.
   */
  const renderSearchEmptyState = (inline = false) => {
    if (isSearching) {
      return <StatusView loading inline={inline} />;
    }
    if (isSearchError) {
      return <StatusView icon="alert-circle" title="Failed to search exercises" inline={inline} />;
    }
    if (ownershipFilter !== 'all' && searchResults.length > 0) {
      return (
        <StatusView
          {...ownershipFilterEmptyState({
            noun: 'exercises',
            filter: ownershipFilter,
            onReset: () => setOwnershipFilter('all'),
          })}
          inline={inline}
        />
      );
    }
    return <StatusView title="No matching exercises found" inline={inline} />;
  };

  const renderSearchResults = () => {
    // With no Suggested block there is nothing worth keeping on screen, so an
    // empty or failed search stays a full-screen status view. With one, the
    // list renders regardless and the status moves inside it — a search that
    // found nothing must not take the shortlist down with it.
    if (!suggestedSection && filteredSearchResults.length === 0) {
      return renderSearchEmptyState();
    }

    return (
      <View className="flex-1 bg-surface">
        <FlatList
          data={filteredSearchResults}
          keyExtractor={(item) => item.id}
          renderItem={renderExerciseRow}
          ListHeaderComponent={suggestedSection}
          ListEmptyComponent={renderSearchEmptyState(true)}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-safe-or-4"
        />
      </View>
    );
  };

  const renderSearchTab = () => {
    if (!isConnected) {
      return <StatusView icon="cloud-offline" title="Connect to a server to view exercises" />;
    }

    if (isSearchActive) {
      return renderSearchResults();
    }

    // Each of these describes the local library only. The Suggested shortlist
    // is fetched independently and is what the user came here for when it
    // exists, so it keeps the list mounted through all three.
    if (!suggestedSection) {
      if (isSuggestedLoading) {
        return <StatusView loading />;
      }

      if (isSuggestedError) {
        return (
          <StatusView
            icon="alert-circle"
            title="Failed to load exercises"
            action={{ label: 'Retry', onPress: () => refetchSuggested() }}
          />
        );
      }

      if (sections.length === 0) {
        if (ownershipFilter !== 'all' && (recentExercises.length > 0 || topExercises.length > 0)) {
          return (
            <StatusView
              {...ownershipFilterEmptyState({
                noun: 'exercises',
                filter: ownershipFilter,
                onReset: () => setOwnershipFilter('all'),
              })}
            />
          );
        }
        return <StatusView title="Search for an exercise to get started" />;
      }
    }

    return (
      <View className="flex-1 bg-surface">
        <SectionList
          ListHeaderComponent={suggestedSection}
          sections={sections}
          keyExtractor={(item, index) => `${index}-${item.id}`}
          renderItem={renderExerciseRow}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-safe-or-4"
        />
      </View>
    );
  };

  // --- Online tab ---

  // Same sibling-pressables layout as the local rows: content imports and
  // selects; the thumbnail and ⓘ open the pre-add preview (the ⓘ slot shows
  // a spinner while importing).
  const renderExternalExerciseItem = ({ item }: { item: ExternalExerciseItem }) => {
    const image = item.images?.[0] ?? null;
    const fallbackIcon =
      (item.category && CATEGORY_ICON_MAP[item.category]) || 'exercise-weights';
    const isImportInFlight = resolvingExerciseId !== null;
    return (
      <View className="flex-row items-center border-b border-border-subtle">
        <TouchableOpacity
          className="pl-4 py-3"
          activeOpacity={0.7}
          accessible={false}
          testID="exercise-thumbnail"
          disabled={isNavigationLocked || isImportInFlight}
          onPress={() => handlePreviewExternalExercise(item)}
        >
          <SafeImage
            source={image ? getImageSource(image) : null}
            style={{ width: 44, height: 44, borderRadius: 8 }}
            fallback={
              <View
                className="bg-raised items-center justify-center"
                style={{ width: 44, height: 44, borderRadius: 8 }}
              >
                <Icon name={fallbackIcon} size={22} color={textMuted} />
              </View>
            }
          />
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 flex-row items-center pl-3 py-3"
          activeOpacity={0.7}
          disabled={isImportInFlight}
          onPress={() => handleImportExercise(item)}
        >
          <View className="flex-1">
            <Text className="text-text-primary text-base font-medium">{item.name}</Text>
            {item.category && (
              <Text className="text-text-secondary text-sm mt-0.5">{item.category}</Text>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          className="px-4 py-3"
          activeOpacity={0.7}
          hitSlop={8}
          disabled={isNavigationLocked || isImportInFlight}
          accessibilityLabel="View exercise details"
          onPress={() => handlePreviewExternalExercise(item)}
        >
          {resolvingExerciseId === item.id ? (
            <ActivityIndicator size="small" color={accentColor} />
          ) : (
            <Icon name="info-circle" size={22} color={accentColor} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderOnlineFooter = () => {
    if (isFetchNextPageError) {
      return (
        <Button
          variant="ghost"
          onPress={() => fetchNextPage()}
          className="py-3"
          textClassName="text-sm"
        >
          Failed to load more. Tap to retry
        </Button>
      );
    }
    if (isFetchingNextPage) {
      return (
        <View className="py-3 items-center">
          <ActivityIndicator size="small" color={accentColor} />
        </View>
      );
    }
    if (hasNextPage) {
      return (
        <Button
          variant="ghost"
          onPress={() => fetchNextPage()}
          className="py-4 mb-4"
          textClassName="text-sm"
        >
          Load More
        </Button>
      );
    }
    return null;
  };

  const renderOnlineSearchResults = () => {
    if (isOnlineSearching && onlineSearchResults.length === 0) {
      return <StatusView loading />;
    }

    if (isOnlineSearchError) {
      return <StatusView icon="alert-circle" title={`Failed to search ${selectedProviderName}`} />;
    }

    if (onlineSearchResults.length === 0) {
      return <StatusView title="No matching exercises found" />;
    }

    return (
      <View className="flex-1 bg-surface">
        <FlatList
          data={onlineSearchResults}
          keyExtractor={(item, index) => `${item.source}-${item.id}-${index}`}
          renderItem={renderExternalExerciseItem}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-safe-or-4"
          ListFooterComponent={renderOnlineFooter()}
        />
      </View>
    );
  };

  const renderOnlineTab = () => {
    if (!isConnected) {
      return <StatusView icon="cloud-offline" title="Connect to a server to search online exercises" />;
    }

    if (isProvidersLoading) {
      return <StatusView loading />;
    }

    if (isProvidersError) {
      return (
        <StatusView
          icon="alert-circle"
          title="Failed to load providers"
          action={{ label: 'Retry', onPress: () => refetchProviders() }}
        />
      );
    }

    if (providers.length === 0) {
      return <StatusView icon="globe" iconColor={textMuted} title="No online exercise providers configured" />;
    }

    return (
      <View className="flex-1">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-4 gap-2 items-center"
          className="grow-0"
        >
          {providers.map((provider) => {
            const isActive = provider.id === selectedProvider;
            return (
              <TouchableOpacity
                key={provider.id}
                onPress={() => {
                  hasUserSelectedProvider.current = true;
                  setSelectedProvider(provider.id);
                }}
                activeOpacity={0.7}
                className={`flex-row items-center rounded-full px-3 py-1 border ${
                  isActive
                    ? 'border-accent-primary bg-accent-primary'
                    : 'border-border-subtle bg-raised'
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    isActive ? 'text-white' : 'text-text-primary'
                  }`}
                >
                  {provider.provider_name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {isOnlineSearchActive ? (
          renderOnlineSearchResults()
        ) : (
          <StatusView icon="search" iconColor={textSecondary} title={`Search ${selectedProviderName} for exercises`} />
        )}
      </View>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'search':
        return renderSearchTab();
      case 'online':
        return renderOnlineTab();
    }
  };

  const header = useScreenHeader({
    title: 'Exercises',
    left: { kind: 'dismiss', onPress: () => navigation.goBack(), identifier: 'exercise-search-cancel' },
    // The filter only applies to the local library, so the Online tab drops it.
    right: activeTab === 'search'
      ? ownershipFilterHeaderMenu({
          noun: 'exercises',
          identifier: 'exercise-search-filter',
          filter: ownershipFilter,
          onSelect: setOwnershipFilter,
        })
      : undefined,
  });

  return (
      <View className="flex-1 bg-background" style={Platform.OS === 'android' ? { paddingTop: insets.top } : undefined}>
      {header}

      {/* Segmented control */}
      <View className="px-4 mt-2">
        <SegmentedControl segments={TABS} activeKey={activeTab} onSelect={setActiveTab} />
      </View>

      {/* Search bar */}
      {renderSearchBar()}

      {/* Tab content */}
      {renderTabContent()}
    </View>
  );
};

export default ExerciseSearchScreen;
