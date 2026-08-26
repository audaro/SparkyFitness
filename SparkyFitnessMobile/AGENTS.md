# AGENTS.md

*Last updated: 2026-08-26*

SparkyFitness Mobile is a React Native 0.85 + Expo SDK 56 app for syncing Apple Health / Health Connect data with the SparkyFitness backend, tracking nutrition, hydration, fasting, measurements, exercise, saved foods, meal templates, custom exercises, workout presets, iOS / Android widgets, the active workout HUD, and the Sparky AI chat.

This is the package guide for `SparkyFitnessMobile/`. Work from this directory for mobile implementation and validation. If a task crosses into the backend, frontend, or `shared/`, read that package guide too before editing outside mobile.

## Scope And Style

- TypeScript is strict. Keep changes type-safe and compiling cleanly.
- Prefer small, direct changes that fit the existing screen, hook, and service boundaries.
- For ambiguous bugs, prove which layer is failing before patching. One narrow diagnostic check beats speculative edits across multiple layers.
- Do not replace a working implementation with a rewrite unless the requester explicitly approves that direction.
- When asked to plan work, confirm scope with clarifying questions before exploring code or drafting the plan.
- Run scripts from `SparkyFitnessMobile/`, except root package operations such as `pnpm install` for patched dependencies.
- Treat `android/` and `ios/` as generated output when possible. Edit `app.config.ts`, `plugins/`, `targets/`, JS/TS sources, or patch files first, then regenerate with prebuild when needed.

## Stack And Imports

- Primary stack: React 19.2, React Native 0.85, Expo SDK 56, TypeScript 6, React Navigation 7, TanStack Query 5, Uniwind / TailwindCSS v4, Reanimated 4, Skia, Victory Native, Expo Background Task / Task Manager / Notifications, Zustand, assistant-ui + AI SDK (chat).
- `@/*` maps to this package and `@workspace/shared` maps to `../shared/src/index.ts`.
- Prefer `@workspace/shared` schemas, constants, date/timezone helpers, and types over local duplicates.
- The app talks to the backend under `/api`; health uploads go to `POST /api/health-data`.
- Global `fetch` is Expo's WinterCG `expo/fetch`, so React Native's `{uri, name, type}` FormData file parts throw "Unsupported FormDataPart implementation". Append an `expo-file-system` `File` (it implements Blob) for multipart uploads; see `pregnancyPhotosApi.ts`.
- Server-stored distance/weight units are metric. UI conversion belongs in mobile helpers such as `unitConversions.ts`.

## Localization contract

English (`en`) is the canonical source locale and the deterministic fallback. Feature developers must add/update the English catalog, use semantic static keys, provide explicit English fallback/defaultValue text, use count-based i18next pluralization, use app-locale date/number/unit formatters, and avoid user-facing hardcoded text. Custom, user, and server content stays literal.

Feature developers do not need to know or translate Polish or any future language, and do not need to wait for Weblate. Translators/Weblate own Polish and future translations and linguistic QA. Missing translation content is non-blocking and falls back to English; existing translated content remains structurally validated.

The shipped locale registry is `src/localization/localeRegistry.ts`. Adding a catalog to Weblate does not ship it. Shipping requires explicit registry enablement plus native/platform support verification. RN catalogs and native resources are separate surfaces (Expo metadata, Android widget resources, and iOS widget/Live Activity `.lproj` resources).

## Commands

```bash
pnpm start
pnpm run ios
pnpm run android
pnpm run lint
pnpm run typecheck
pnpm run validate
pnpm exec jest --watchman=false --runInBand
pnpm exec jest --watchman=false --runInBand <test-path>
pnpm run test:coverage -- --watchman=false --runInBand
pnpm run muscle-art:generate
pnpm run muscle-art:render
npx expo prebuild --clean
```

- `pnpm run validate` runs the generated-locale-resources check, TypeScript typecheck, Expo lint with zero warnings, the blocking i18n audit, the native widget locale check, and `muscle-art:check` (re-derives the generated body art and fails if the committed file is not what the illustration produces today).
- Use Watchman-disabled Jest commands in agent/sandbox runs; bare Jest often fails on macOS.
- `collectCoverage` is enabled in Jest config, so expect coverage output from normal test runs.
- Run `npx expo prebuild --clean` after native dependency changes, permissions, app group or widget target changes, Expo plugin changes, native config edits, or patching native modules.
- After editing the root `patches/react-native-health-connect@3.5.3.patch`, run `pnpm install` from the repo root, then prebuild from mobile.

## App Shell And Navigation

- `App.tsx` is the root composition point. `App()` wraps `QueryClientProvider`, `KeyboardProvider`, `GestureHandlerRootView`, and `BottomSheetModalProvider`; `AppContent()` owns `NavigationContainer`, `SafeAreaProvider`, navigators, `AddSheet`, auth modals, the embedded/floating active-workout bars, the tab-bar `WhatsNewBanner`, and toasts.
- App-shell logic lives in dedicated hooks that `AppContent` composes: `useAppBootstrap` (`src/hooks/useAppBootstrap.ts`) owns language initialization, initial-route selection, the initial linking-enabled state, and splash hiding; `useAppStartup` (`src/hooks/useAppStartup.ts`) owns the one-time startup services (theme, notifications, notification actions, background sync, HealthKit observers); `useAutoSyncOnOpen` (`src/hooks/useAutoSyncOnOpen.ts`) for cold-start/foreground-return sync and the observer-yield window; `useAddSheetActions` (`src/hooks/useAddSheetActions.ts`) for AddSheet handlers and last-active-tab tracking. Error-boundary-wrapped `Safe*` screen components live in `src/navigation/safeScreens.tsx`.
- Startup initializes theme, haptics, sounds, notification prefs, logs, timezone bootstrap, background sync, pending cache refreshes, fasting/hydration card visibility, and platform health observers.
- Initial route comes from `getActiveServerConfig()` inside `useAppBootstrap`: no active config lands on `Onboarding`; otherwise users enter `Tabs`. A language-initialization failure is logged and never changes the route.
- Deep links are enabled only after startup confirms `Tabs`, so widget links do not bypass first-run onboarding.
- Navigation source of truth is `App.tsx` plus `src/types/navigation.ts`; update both and the linking config when routes change.
- Root stack uses `@react-navigation/native-stack`. Tabs use `@react-navigation/bottom-tabs`.
- Tabs are `Home`, `Exercise`, `Add`, `Food`, and `Settings`. `Add` is a center action in `CustomTabBar`, not a content screen. `Home` renders `DashboardScreen` and `Food` renders `DiaryScreen`; the tab route names and the screen file names deliberately differ, so grep for the route name in `TabParamList` rather than assuming a matching file.
- Native iOS Liquid Glass tabs use `@bottom-tabs/react-navigation` in `src/components/TabsLayout.tsx`; each content tab is wrapped in its own `createNativeStackNavigator` so the tab path still gets native headers.
- `TabsLayout` switches at runtime via `useNativeIOSTabsActive()` (`services/nativeTabBarPreference.ts`): native tabs require iOS 26+ Liquid Glass support AND the user's `liquidGlassTabBarEnabled` preference (opt-in). Everything else renders `CustomTabBar` (`TAB_BAR_HEIGHT = 56`); `ActiveWorkoutBar` reads the native tab-bar height instead when native tabs are active.
- When adding a root-stack screen, add the route to `RootStackParamList` and register a matching `<Stack.Screen>` in `App.tsx` with `createStackScreenOptions(...)` or equivalent explicit iOS native-stack header options.
- Native header option/button builders live in `utils/nativeHeaderItems.ts` (`createIOSNativeHeaderOptions`, `createIOSSmallNativeHeaderOptions`, text/icon button items); header action colors come from `useHeaderActionColors`, which is Liquid-Glass-aware on iOS.
- Root-stack screens with a screen-owned React header are automatically checked by `__tests__/navigation/nativeHeaderContract.test.ts`; do not add screen-specific native-header allowlists.
- Root-stack screens with a screen-owned React header and a real back button must set `headerBackTitle` or `headerBackButtonDisplayMode: 'minimal'` in `App.tsx` so iOS back labels stay explicit or intentionally hidden; close/cancel modal headers do not need either option.
- Declare screen headers with `useScreenHeader(config)` (`src/hooks/useScreenHeader.tsx`), or the thin `<ScreenHeader …/>` wrapper when nothing interleaves with the bar. One declarative descriptor (`title`/`nativeTitle`, `left`/`right` items of kind `back`/`dismiss`/`text`/`icon`/`primary`/`menu`, `busy`/`disabled`, `animateKey` for view↔edit cross-fades) renders both paths: on the native path it mirrors items into `unstable_header{Left,Right}Items` via a layout effect and returns `null`; on the custom path it returns the bar element for the screen to render. A `menu` item is a declarative dropdown (plain actions and/or titled single-select sections, optional accent-dot `showsBadge`): the native path builds a system UIMenu header button, the custom path renders the trigger plus an `AnchoredMenu` under it — one item list drives both, as in `FoodsLibraryScreen`'s ownership filter. Hook screens must not keep hand-rolled header code (no `unstable_header*Items` blocks or custom bars alongside the hook) — the contract test enforces this.
- Path selection is `useNativeIOSHeadersActive()` (`services/nativeTabBarPreference.ts`): always false on Android; on iOS it is true below iOS 26 (classic native headers) and follows the Liquid Glass toggle on iOS 26+, so turning the toggle off swaps in the same screen-owned fallback headers Android renders.
- One-accent rule: exactly one primary header action per screen (`kind: 'primary'` or `role: 'primary'`), enforced with a `__DEV__` throw; primary header save buttons fall back to the localized `t('common.save')` / `t('common.saving')` labels when no `label`/`busyLabel` is supplied. Footer-save forms mark their header Save `placement: 'native-only'` so the custom bar does not duplicate the sticky-footer button. `onPress` handlers dispatch through the hook's internal ref map — do not add per-screen handler-ref effects for native header buttons.
- A **right-slot** `kind: 'primary'` press is wrapped in the shared synchronous duplicate-press guard (`utils/duplicatePress.ts`, same one `FooterSaveBar` uses): presses inside `DUPLICATE_PRESS_WINDOW_MS` collapse to one. `disabled`/`busy` are React state and have not committed when taps queued behind a blocked JS thread replay, so every queued press otherwise ran the handler again (#2191). The guard is deliberately time-based, not a latch on `busy`, because handlers that never report a pending state would leave the button dead. **Left-slot** primaries are exempt — that slot is navigation, and `CycleOnboardingScreen` uses the sugar for a wizard Back where repeated presses are intended. A screen that needs a rapidly repeatable right-slot action must not use `kind: 'primary'`.
- If a root-stack screen is intentionally presented above `Tabs` instead of inside native-tabs mode, document it in `NATIVE_TABS_ROUTE_EXCLUSIONS` in `__tests__/navigation/nativeHeaderContract.test.ts` with a short reason.
- Screens intentionally off the hook (e.g. `FoodSearchScreen`'s bespoke anchored-menu bar) must mirror custom actions with `unstable_header{Left,Right}Items` themselves, hide the screen-owned React header behind `useNativeIOSHeadersActive()` with a guard such as `{!usesNativeHeader && <Header />}`, and gate the `useLayoutEffect` that sets native header items on the same flag; otherwise iOS renders both headers.
- When adding or renaming a tab, update six things in lockstep: `TabParamList`, `NativeTab.Screen`, `FallbackTab.Screen`, `NON_ADD_TABS` (`TabsLayout.tsx:29`), the tab-local native stack screen built with `createIOSNativeHeaderOptions(...)`, and `TAB_ICONS` in `CustomTabBar.tsx`. The contract test guards the first five. `TAB_ICONS` it does not, but that map is keyed to `Exclude<keyof TabParamList, 'Add'>`, so a renamed tab without a renamed icon entry is a typecheck failure rather than a silently label-only tab on Android and iOS < 26; `__tests__/components/CustomTabBar.test.tsx` additionally asserts every tab draws an icon.
- `__tests__/navigation/nativeHeaderContract.test.ts` enforces this native-header wiring. If it fails, fix the route/type/navigator alignment instead of weakening the test.
- Current stack screens include onboarding/tabs, library/detail/form flows for foods/meals/exercises/presets, food entry view/edit, meal type detail and copy, `EditBarcode`, food search/entry/scan/photo flow, workout/activity add/detail, exercise/preset search, settings subscreens, logs, sync, measurements, fasting, and `WhatsNew`.
- `AddSheet` offers Food, Workout, Activity, Preset, Measurements, Scan Food, Ask Sparky, and Sync Health Data. Keep its present/dismiss refs intact to avoid Android re-present loops.
- `useNavigationActionGuard` locks navigation-triggering actions while a native-stack transition is running (idle-callback unlock on re-focus, 5s safety release) so double-taps cannot queue duplicate screens; Library create actions use it.
- `ActiveWorkoutBar` is mounted outside normal screen trees, uses the root navigation ref, and hides itself on modal/editor routes such as food search/forms/scan/photo, exercise search, workout/activity add, measurements, and barcode edit.
- Most screens are wrapped with `withErrorBoundary(...)`; `SettingsScreen` also uses section-level recovery so settings remain reachable.

## Source Map

- `src/components/` - reusable UI, charts, settings rows, custom tab bar, add sheet, workout HUD, form chrome, library rows, diary rows, serving sheets, food/workout editors, fasting UI, writeback UI, and `ui/` primitives.
- `src/components/auth/` - MFA UI shared by onboarding, setup, and reauth.
- `src/screens/` - top-level route destinations: dashboard, diary, settings, sync, logs, Whats New, fasting, food search/scan/photo, library CRUD flows, workout/activity flows, and measurement entry.
- `src/navigation/` - navigation-level modules such as `safeScreens.tsx`, the error-boundary-wrapped screen components registered in `App.tsx`. (`FoodPhotoFlow` lives in `src/components/`.)
- `src/hooks/` - TanStack Query hooks, auth/connection hooks, library/search/mutation hooks, measurement/water/check-in hooks, fasting hooks, workout form hooks, widget sync, query client, query keys, and cache helpers.
- `src/services/api/` - backend clients. `apiClient.ts` handles normal API auth/proxy headers; `healthDataApi.ts`, `aiSettingsApi.ts`, food-photo estimate, and other raw fetch paths must keep auth, proxy, timeout, and session-expiry behavior aligned.
- `src/services/healthconnect/` - Android Health Connect reads, native aggregation, transformation, enrichment, preferences, and writeback.
- `src/services/healthkit/` - iOS HealthKit reads, statistics aggregation, transformation, background delivery, preferences, and writeback.
- `src/services/shared/` - platform-agnostic health helpers: the `collectHealthData` / `runForegroundSync` engine both orchestrators share, the per-run workout-telemetry budget and its reuse cache, Health Connect error classification, sample downsampling, day aggregation/transformation, preference factories, and permission migration/sets.
- `src/services/` - platform health orchestration, writeback re-exports, background sync, auto-sync coordination, diagnostics, calculations, logging, storage, theme, haptics, sounds, notifications, food photo intro, meal selection, boolean preferences, card visibility, and workout drafts.
- `src/stores/` - Zustand stores, including the persisted active workout/rest timer store.
- `src/utils/` - date helpers, unit conversion, food details, meal nutrition, nutrient display, workout/session helpers, fasting formatting, numeric input, concurrency, sync utilities, duplicate-press guarding, photo estimate error mapping, and rate limiting.
- `src/constants/` - meal, exercise, fasting, and nutrient metadata.
- JS bridges to native modules live in `src/services/` (`CalorieWidgetBridge.ts`, `ExactAlarmBridge.ts`); there is no `src/native/` directory.
- `plugins/`, `targets/widget/`, `targets/android-widget/`, `targets/android-exact-alarm/` - Expo plugins and widget/native extension sources.

## React Query And Local State

- Query setup lives in `src/hooks/queryClient.ts`; keys live in `src/hooks/queryKeys.ts`.
- Default `staleTime` is `Infinity`, so mutations must explicitly invalidate or update affected caches.
- `useRefetchOnFocus(refetch, enabled)` is the standard focus-refresh hook.
- `useFoodsLibrary` is an intentional exception with an infinite query, finite stale window, and `resetQueries(...)` refreshes so focus/pull refresh reloads page 1 instead of every cached page.
- Meal mutations invalidate meals, recent meals, search, and details; food entry creation can affect recent meals.
- Exercise/workout preset list/search/detail invalidation belongs in their mutation hooks.
- `useUpsertCheckIn` updates measurement queries and calls `refreshHealthSyncCache(queryClient)`.
- `useWaterIntakeMutation` fetches `waterContainersQueryKey`, persists the selected container, and optimistically updates `dailySummaryQueryKey(date)`.
- Active-server switches clear React Query state before refetching connection state.
- Error-boundary retry flows call `queryClient.resetQueries()`.
- App-local toggles live in `stores/appPreferencesStore.ts` (Zustand `persist`, single AsyncStorage key `@SparkyFitness/app-preferences`): haptics, sounds, notifications, hydration/fasting card visibility, Ask Sparky card visibility, the Liquid Glass tab bar opt-in, the active-workout metric column, and the default rest period (`defaultRestSec`, edited in `WorkoutSettingsScreen`). Consume via selectors (`useAppPreferencesStore((s) => s.hapticsEnabled)`) plus generated setters; non-React code reads current values through helpers like `getDefaultRestSec()`. A legacy-aware storage adapter migrates the old per-key `@HealthConnect:*` values once. These preferences never sync to the server.

## Health Sync

- `src/services/healthConnectService.ts` is Android orchestration; `src/services/healthConnectService.ios.ts` is iOS orchestration. They are substantial platform implementations, not thin wrappers.
- Both orchestrators batch metric reads with `runTasksInBatches`, a concurrency of 3, and per-metric timeouts. Preserve timeout and partial-error handling.
- Bootstrap timezone state before sync. `ensureTimezoneBootstrapped(...)` runs at startup and `healthDataApi.ts` enforces it before upload.
- Preserve `record_timezone` and `record_utc_offset_minutes` when available.
- Manual sync, sync-on-open, foreground-return sync, background sync, and iOS observer-triggered sync share coordination logic. Preserve claim/in-flight guards and cooldown recording.
- Health uploads are chunked. Simple measurements use large chunks; sleep sessions use smaller session chunks; exercise/workout records are grouped by source to match server delete-then-insert behavior.
- Sync result objects include `syncErrors`; callers should surface partial failures and avoid advancing `lastSyncedTime` when any metric read failed.
- `backgroundSyncService.ts` uses overlap windows for sessions and day-aligned rolling windows for cumulative metrics and nutrition. Do not collapse those into one naive window.
- On iOS, cumulative metrics should use HealthKit statistics queries, not raw sample summation.
- On Android, cumulative metrics (`Steps`, `Distance`, `ActiveCaloriesBurned`, `TotalCaloriesBurned`, `FloorsClimbed`) use Health Connect `aggregateGroupByPeriod` once per range. Native source-priority dedup should match Health Connect UI; do not reintroduce JS `Math.max` or source allowlist dedup.
- Android read helpers return `{ records, error }` via `readHealthRecordsDetailed` and `aggregateCumulativeMetricByDayDetailed`; legacy wrappers unwrap only records.
- Android exercise sessions are enriched with `aggregateRecord` for active/total calories and distance over the session window. Calories start scoped to `dataOrigin`; incomplete or implausible pairs retry without the origin filter so Health Connect can apply source priority. Distance always stays origin-scoped. Both are filtered for plausibility.
- iOS HealthKit locked-device failures surface as database-inaccessible warnings. Do not treat these as successful empty reads.
- `app.config.ts` grants `android.permission.health.READ_HEALTH_DATA_HISTORY` so Android can read data older than 30 days.
- Health Connect permission migrations belong in `services/shared/healthPermissionMigration.ts`, not UI-only state.
- Core check-in measurements use `measurementsApi.ts` and `MeasurementsAddScreen`; preserve `upsertCheckIn` omitted-vs-null semantics.
- "Import Full History" (`ImportHistoryScreen`, reached from `SyncScreen`) is a one-time resumable backfill: `backfillService.ts` walks 30-day day-aligned windows newest-first from start-of-today down to a probe-derived floor (`readEarliestRecord` on both providers), one upload per window, with a per-server checkpoint in `backfillCheckpoint.ts`. It never advances `lastSyncedTime` and never runs writeback; while it runs, `isBackfillRunning()` (autoSyncCoordinator) makes background sync skip.
- The backfill's metric set is FROZEN in its checkpoint at first run; resume uses the frozen set verbatim and toggle changes require Start Over. Quota exhaustion, locked device, and app-inactive are expected mid-run stops — the checkpoint keeps them resumable.

## Health Writeback

- Writeback sends Sparky diary nutrition and hydration back to Apple Health on iOS and Health Connect on Android.
- Platform split: `services/writeback.ios.ts` re-exports `healthkit/writeback.ts`; `services/writeback.ts` re-exports `healthconnect/writeback.ts`.
- `runWriteback()` runs after inbound sync in its own try/catch. Writeback failures must not block inbound sync results.
- Writeback is opt-in per metric and gated on write permissions. Android production permissions include `WRITE_NUTRITION` and `WRITE_HYDRATION`; other write permissions are dev-only.
- Imported health entries are skipped to avoid echo loops. iOS sets the app bundle id as the own-source guard; Android relies on source metadata.
- Per-day content-signature hashing skips unchanged days. Each run deletes prior tracked UUIDs then saves fresh records; failed deletes are retried next run.
- `HealthDataWriteback` on `SyncScreen` owns the remove flow. `BottomSheetPicker` offers all-time purge or date range through `DateRangeSheet`; both call `removeWrittenData(range)` and clear tracking.
- Inbound iOS nutrition sync reads food correlations with a rolling nutrition lookback and upserts by `(source, source_id)` server-side.

## Native Patches

- `react-native-health-connect` is declared as `^3.5.3`; the installed 3.5.3 build is patched from the repo root via `pnpm.patchedDependencies`.
- Patch file: `../patches/react-native-health-connect@3.5.3.patch`.
- The patch changes Android `getAggregateGroupByPeriodRequest` implementations from instant-based `getTimeRangeFilter` to local-date-time `getTimeRangeFilterLocal` for non-Steps record types. This protects per-day grouping around DST and local-day boundaries.
- `@bacons/apple-targets@4.0.6` is patched via `../patches/@bacons__apple-targets@4.0.6.patch`, fixing two upstream bugs. First, its xcode pass matched "its" extension target by type with a fall-back to any same-type target, which adopted and corrupted the expo-widgets `ExpoWidgetsTarget` on a clean prebuild; the patch scopes the match to an exact product-name hit. Second, the existing-target update path crashed every non-clean prebuild (EvanBacon/expo-apple-targets#201): removing the old build configuration list's referrers cleared `target.props.buildConfigurationList`, which the next line then dereferenced; the patch holds the list in a local and iterates a copy of its configurations so none are skipped mid-removal.
- After changing a patch or upgrading a patched package, run `pnpm install` from the repo root and then `npx expo prebuild --clean` from mobile before native validation.

## Food, Meals, Units, And Photo Estimates

- Food search spans local foods, online providers, meals, barcode scan, label scan, and AI photo estimates. Keep `FoodSearchScreen`, `FoodScanScreen`, `FoodEntryAddScreen`, `FoodFormScreen`, `FoodPhotoFlow`, and route params aligned.
- `DiaryScreen` (the Food tab) is both the day's food diary and the food hub: under the day's entries it carries create tiles for a food and a meal, quick-access rows into `FoodsLibraryScreen` / `MealsLibraryScreen`, and a recently-logged list. The two halves fail independently — the day's summary read renders its own inline status inside the shared scroll view rather than replacing the screen, so a slow or failed read never takes the create/browse sections down with it. `LibraryScreen` is gone; `ExercisesLibraryScreen` and `WorkoutPresetsLibraryScreen` are reached from the Exercise tab, and `MedicationsList` from a row on `DashboardScreen`.
- Food detail/edit flow: `FoodDetailScreen`, `FoodFormScreen`, `FoodForm`, `FoodUnitSelectorSheet`, `useFoodVariants`, `useFoodsLibrary`, `useDeleteFood`, `foodsApi`, and `utils/foodDetails.ts`.
- `FoodForm` supports equivalent serving sizes grouped by nutrient signature, auto-scale nutrition, compatible unit conversion via `convertServingSizeOnUnitChange`, optional AI cross-category unit conversion, custom nutrients, and caller-provided `headerChildren`.
- `EditBarcodeScreen` lets users add or remove extra barcodes for a saved food. Keep `FoodDetailScreen`, `EditBarcodeScreen`, `foodsApi`, and the `EditBarcode` route params aligned.
- Meal templates use `MealAddScreen`, `MealDetailScreen`, `FoodSearch` / `FoodEntryAdd` with `pickerMode: 'meal-builder'`, and `services/mealBuilderSelection.ts` for pending ingredient handoff.
- Logged-meal grouped diary entries use `foodEntryMealsApi`, `FoodEntryViewScreen`, and `EditLoggedMealScreen`. Preserve stored component nutrition snapshots when editing.
- `MealTypeDetailScreen` owns single-meal-type day views and copy-to-another-day via `useCopyFoodEntries`; be careful with custom meal types and synthetic buckets.
- External food providers use provider-agnostic v2 endpoints where possible. Provider categories and barcode support come from server config; do not hardcode provider type allowlists unless preserving an explicit fallback.
- "All Providers" aggregated search (`useAllProvidersSearch`) fans one debounced term out across every active provider in parallel — one `useQueries` entry per provider, results projected in the `combine` callback for structural sharing. Providers stream in independently; a slow or failing provider must not block the others. Open Food Facts calls go through the shared rate limiter.
- Photo mode is hidden in meal-builder mode because photo estimates log to the diary.
- `FoodPhotoFlow` is a modal native stack and wraps itself in a local `KeyboardProvider`.
- Photo availability fetches `GET /api/chat/ai-service-settings/active` through `aiSettingsApi.ts`; food photo is attempt-all, so `isFoodPhotoAvailable` gates only on a configured provider, not a specific provider type.
- Estimation posts to `POST /api/foods/estimate-food-photo` through `estimateFoodPhoto(...)` in `externalFoodSearchApi.ts` and uses typed `FoodPhotoEstimateError` codes from `@workspace/shared`.
- Food-photo request/response changes cross package boundaries: update shared schema and server route/service with mobile.
- Keep `auto_scale_online_imports` separate from Open Food Facts-specific scaling preferences in `FoodSettingsScreen`.

## Exercise, Workouts, And Fasting

- `ExerciseHomeScreen` is the Exercise tab: `UpNextCard` verbatim, the weekly-set-target ring at summary size, the `MuscleRecoveryStrip`, the day's `ExerciseSummary` log under a `DateNavigator`, create tiles for a custom exercise and a workout preset, Quick access rows into the exercise library and workout presets, and a Setup section holding gym profiles, weekly set targets, and exercise packs. `WorkoutSettingsScreen` keeps only device and behaviour preferences (default rest period, rest timer sound, keep screen awake) — training *configuration* lives on the tab, not in Settings. It is a hub — it navigates and summarizes, and every mutation lives on the screen it routes to (the create tiles are the app's only route into `ExerciseForm {create-exercise}` / `WorkoutPresetForm {create-preset}` from scratch).
- The Exercise tab keeps its **own** selected day: `stores/exerciseDateStore.ts` and `stores/diaryDateStore.ts` are two instances of the `createDateStore()` factory, because the sections above the log are "now"-based and must not follow a day scrubbed back to on the Food tab. Both day-scoped tabs publish their day through `navigation.setParams({ selectedDate })`, and `useAddSheetActions.getActiveDiaryDate()` picks between them using `lastActiveTabRef` — not the tab state, which reports `Add` as selected while the sheet is open. A new day-scoped tab must publish its day the same way or the Add sheet will date its entries to the wrong tab's day.
- Exercise and workout preset flows use `ExerciseSearch`, `PresetSearch`, detail/form screens, paginated/search hooks, mutation hooks, and shared workout payload helpers in `utils/workoutSession.ts`.
- Session responses are discriminated unions from `@workspace/shared`: preset workouts and individual activity sessions have different shapes. Keep detail/edit screens type-safe.
- Workout/activity drafts are persisted by `workoutDraftService`; `useWorkoutForm`, `useActivityForm`, and `useDraftPersistence` own form state.
- Exercise selection returns via `CommonActions.setParams` and a nonce pattern through `useSelectedExercise`.
- Rest timer state lives in `stores/activeWorkoutStore.ts`; notifications are scheduled through `services/notifications.ts`. The rest-complete ping carries a background "Complete Set" action (`rest-complete` category): responses are routed to `completeActiveSetIfReady` by `initWorkoutNotificationActions` (exported from the store, wired in App startup — the response listener cannot live in `notifications.ts` without a store↔service import cycle), and stale delivered pings are swept when the next rest is scheduled.
- Set IDs are preserved server-side across workout edits so the active workout cursor stays attached to the right row.
- Weekly set targets (working sets per training group against a weekly goal) live in `WeeklySetTargetsScreen`, reached from the Exercise tab's "This week" card and from its Setup section (the card hides itself when the read came back with nothing, so the row is what keeps the screen reachable), backed by `services/api/weeklySetTargetsApi.ts` + `hooks/useWeeklySetTargets.ts`. The hexagon ring is `components/HexagonProgressRing.tsx` (Skia, one arc per group, static paths — the React Compiler rejects manual memos in this screen, so do not reintroduce `useMemo` there). It renders at two sizes on two screens, so the group colours come from `hooks/useWeeklySetGroupColors.ts` and set counts from `formatSetCount` (`@workspace/shared`, moved there when the web week card became its second consumer) — counts are fractional because a secondary mover is half a set, so never round them. Editing sends only the changed group: the server merges a partial map, and resending all four would clobber an edit made elsewhere. The mutation writes the server's recomputed response straight into the cache rather than invalidating.
- Per-muscle recovery is `components/MuscleRecoveryStrip.tsx` on the Exercise tab, backed by `fetchMuscleRecovery` (`services/api/workoutRecommendationsApi.ts`) + `hooks/useMuscleRecovery.ts` against `GET /api/workout-recommendations/recovery`. The wire's `freshness` is **0.0–1.0, not a percentage**; the hook's `select` derives `percent` and a coarse `tone` once per fetch through `freshnessPercent`/`freshnessTone` (`@workspace/shared`, moved there when the web recovery card became their second consumer), so nothing downstream multiplies by 100 again. The response is a complete vector over all 17 canonical muscles, already sorted freshest-first — render it in the order it arrives rather than re-sorting, so the strip agrees with the muscles the generator would pick. The strip hides on empty data, never on `isError` (it refetches on focus, so the error flag is true over cached data whenever the user is offline).
- `UpNextScreen`'s "Swap workout" button opens the **swap sheet**: an `ActionSheet` of the ways to get a *different* workout — Pick Muscles, Saved Workouts, Create From Scratch, On Demand. Acting on the workout that is already there is the header's **⋯ menu** (`useScreenHeader`'s `kind: 'menu'`): **Save workout**, which navigates to `WorkoutPresetForm {mode:'create-preset', sourceRecommendation}` so the template is reviewed and named before anything is written, **Build superset/circuit**, and **Refresh**, which is `generate({swap: true})` — the screen's only whole-workout swap path. Share is deferred indefinitely and is deliberately not a row.
- Superset grouping built on `UpNextScreen` is **local screen state applied at start-workout, never written back to the recommendation** (blueprint D9): Swap, Refresh, Replace and the duration/gym chips all replace the payload wholesale, so a stored grouping would be discarded silently. The plan is held keyed by a signature of the prescribed exercise ids and derived during render — a stale key means the grouping belongs to a workout no longer on screen — and `handleStart` hands the grouped plan to `buildRecommendationStartPayload`, which takes an already-ordered `PlannedExercise[]` (it must not re-sort, or grouping's reordering is undone). `PlannedExercise` is the third shape of the shared algebra in `utils/workoutSupersets.ts` (`supersetPlannedExercises` / `ungroupPlannedExercise` / `getPlannedSupersetRuns`), keyed on `exercise_id`/`superset_group`, and it harmonizes both `rest_seconds` and every `sets[].rest_time` because the row chip reads the former and the started entries read the latter. Building is the ⋯ menu's two-stage sheet (anchor, then partner — an anchor already in a run extends it into a circuit); ungrouping is on the row's own ⋯ menu, next to the group it would break up.
- Which header action `UpNextScreen` declares depends on the body: `renderContent()` only reaches the Swap button once a workout exists, and the loading/error/empty branches render a `StatusView`, which takes exactly one action and has already spent it on Generate/Retry. So the header carries the ⋯ menu when a workout is on screen and a neutral "New" text item that opens the swap sheet when one is not — never both, and neither is `role: 'primary'`, so the screen still declares no accent header action. Header menu entries carry no disabled state on either path, so the ⋯ handlers guard themselves.
- Seeding a preset from a generated workout is `buildRecommendationDraftExercises` / `recommendationPresetName` (`utils/workoutSession.ts`), the sibling of `buildRecommendationStartPayload` and gated identically — canonical set types re-keyed to mobile's vocabulary, distance kept only where the modality means it, no between-set rest on cardio — so the saved template matches what starting the workout would log. Both walk `orderedRecommendationExercises`, and so must any caller generating client ids for them, or the ids misalign against a payload whose array order disagrees with `sort_order`.
- Muscle targeting for the next generated workout is `PickMusclesScreen`, reached from the swap sheet's "Pick Muscles" row. It is one root-stack screen with two modes (`GymProfilesScreen`'s list/editor shape): a split list, and a per-muscle picker that is an anatomical body map. **Splits are resolved to canonical muscles on the client** — `MUSCLE_SPLITS` / `MUSCLE_SPLIT_MEMBERS` from `@workspace/shared` — and the generate request carries the muscles, never a split name. "Recovered muscles" is the *absence* of a constraint and must **omit** `target_muscles`: the field is `.min(1)`, so `[]` is a 400, and omitting it is a different request from naming every muscle. The picker's grouping lives in `constants/muscleTiles.ts` (Back is one tile covering `lats` + `middle back`); it is UI only, it partitions all 17 canonical muscles, and `__tests__/constants/muscleTiles.test.ts` asserts that.
- The muscle picker is an anatomical **body map**: `components/MuscleBodyMap.tsx` renders `BODY_PATHS` from `constants/muscleArt.generated.ts`, every labelled region tappable as its muscle. It draws **one figure at a time** — a `SegmentedControl` above it flips front/back, and each view has its own `viewBox` in `BODY_VIEWS`. That is what makes the regions tappable at all: with both figures on screen at once most muscles are 10–20pt across. Both boxes are emitted at the same size so flipping does not resize the body under the user's finger, and `BODY_VIEW_ASPECT` is the single aspect the container draws into. Selection is shared across the two views, and a `Selected (n)` readout under the figure names each pick with its recovery (`Chest · 100% recovered`) and drops it when tapped. That readout is not the old chip row returning: those chips were *pickers* for muscles the figure could not reach, and there are none of those left.
- `muscleArt.generated.ts` is GENERATED. `pnpm run muscle-art:generate` derives it from `SparkyFitnessFrontend/public/images/muscle-male.svg`, the illustration the web body map already renders — never hand-edit it. `pnpm run muscle-art:check` re-derives and diffs without writing, and `validate` runs it, so a hand-edit or an upstream redraw fails the gate instead of shipping. `pnpm run muscle-art:render` draws both views — plain, authored-regions-highlighted, and with a selection applied — to PNG via `qlmanage` into a gitignored `.muscle-art-render/`; every hand-authored shape gets eyeballed there before it lands, because no test can judge whether a blob looks like a neck.
- The derivation itself lives in `scripts/muscle-art/build.mjs`, shared by the generator and the renderer so what gets eyeballed is what ships. **The figure covers all seventeen canonical muscles**, which takes two interventions, both fail-loud. `relabelled-paths.mjs` re-labels four upstream paths — the wings under the armpits (classed `obliques`, which folds into `abdominals`, so tapping a lat used to select Abs) are `lats`, and the slabs down the spine (classed `traps`) are `middle back` — **keyed on the exact `d` string, never on a path index**, and an override that matches nothing throws. `authored-shapes.mjs` merges five hand-drawn regions for `neck`, `adductors` and `abductors`, which upstream has no geometry for at all; it is a separate input file so regeneration cannot silently drop them. The build also throws if an authored shape falls outside the silhouette, or if any canonical muscle ends up with no region.
- **The array is in the illustration's document order, which is its render order** (silhouette under, muscles over it, outline detail last; the authored regions splice in after the last upstream muscle) — do not sort or group it while rendering, or the head and hands end up beneath the muscles.
- The body map selects *muscles* while the screen's state is *tiles* — `tileForMuscle` bridges them, so tapping either half of the Back tile lights both, which is honest only because both are now drawn. `__tests__/constants/muscleArt.test.ts` asserts no tile is half-drawn, that every canonical muscle is a real tap target on at least one view (traps is deliberately small in front and broad behind), that each view's `viewBox` contains its whole figure, and that no authored region escapes the body.
- A muscle is drawn in several paths (eight for the quads): all of them are pressable, but only the first *on that view* carries the testID and the accessibility label, because `react-native-svg` passes only `accessible`/`accessibilityLabel` through to a path — no role, no checked state, so selection and recovery are spoken in the label text. A selected region is the accent at full strength plus a halo, drawn by redrawing the same paths beneath it with a thick low-opacity stroke (SVG cannot union paths); unselected regions sit at 0.45 opacity in their recovery tone from `hooks/useFreshnessToneColors.ts`, so the figure and the recovery strip cannot disagree. **The illustration draws no lines of its own** — what separates the eight paths of the quads is the silhouette showing through the gaps between them — so a selected path, being opaque, also strokes its own edge in the silhouette's colour (`SEAM_STROKE_WIDTH`) or the pick renders as one flat slab. Never stroke a selected path in the accent: same colour as the fill, it closes the seams instead of drawing them.
- Themed one-tap generation is `OnDemandWorkoutsScreen`, reached from the swap sheet's "On Demand" row, listing `ON_DEMAND_WORKOUTS` from `@workspace/shared`. A theme is a **named bundle of generate parameters and nothing more** — a `duration_minutes` and usually a set of canonical muscles — so there is no curated content, no table and no endpoint of its own: the engine programs the session as it does everywhere else and the active gym profile still filters it. The bundles live in `shared/` rather than in mobile `constants/` because they are request bodies, not display layout (contrast `constants/muscleTiles.ts`, which is the grid's UI-only grouping and correctly stays local); `shared/` has no test runner, so they are asserted from the **server** package — `SparkyFitnessServer/tests/onDemandWorkouts.test.ts` parses every theme against `generateWorkoutRecommendationRequestSchema`, because nothing type-checks a duration against the wire's 15–180 bound. Build the body with `onDemandGenerateRequest(theme)`, never by hand: a theme with no muscle constraint must **omit** `target_muscles` rather than send `[]` (the field is `.min(1)`, and omitting it is a different request from naming every muscle). Themes are chosen to be what the Pick Muscles split list cannot say — a pinned session length, or a combination that is not a split — and where one does line up with a split it resolves through `MUSCLE_SPLIT_MEMBERS` so the two lists cannot drift.
- `PickMusclesScreen` and `OnDemandWorkoutsScreen` are both **pickers that own their generate**: the selection goes straight into `POST /generate` and the screen lands on the workout it built, rather than handing a choice back to Up Next to act on. That shape is `hooks/useGenerateAndShowWorkout.ts` and a third picker must reuse it, because the guards are its whole substance. The in-flight check is a **ref, not the mutation's `isPending`** — a `disabled` prop follows a render and loses to a fast double-tap (the same reason `useStartLiveWorkout` uses one). The mounted check exists because backing out mid-request is legitimate — the workout still lands in the recommendation cache Up Next reads — while pushing a screen at someone who already left is not. The hook does not invalidate anything: generation writes the fresh row into the shared cache itself. `onBeforeNavigate` is the seam for a screen that guards its own departure, and `PickMusclesScreen` is the reason it exists — it blocks `beforeRemove` while its grid is open and has to be told that this one departure is its own.
- Gym equipment profiles (named, switchable equipment sets) live in `GymProfilesScreen`, reached from the Exercise tab's Setup section, backed by `services/api/gymProfilesApi.ts` + `hooks/useGymProfiles.ts`. One list screen with an inline editor mode; equipment chips are driven by the shared `EQUIPMENT` constant and store **canonical lowercase** values, because the catalog filter (`equipment::jsonb ?|`) is exact and case-sensitive — capitalize for display only. Activation is a dedicated endpoint (`POST /:id/activate`), never a field on the `PUT`, so switching profiles always refetches rather than patching the cache.
- Replacing one exercise in a suggested or live workout goes through `ExerciseSearch` with a `suggestForExerciseId` route param: the screen renders a "Suggested" section of ranked alternatives (`useExerciseAlternatives`) above the normal results as the list header, so Replace is a shortlist rather than a blank search box. External suggestions are imported and local ones refetched in full via `fetchExerciseById` before selection — an `AlternativeExercise` carries no `category`/`modality`/`calories_per_hour`, and callers snapshot what they are handed. The ⋯ row menus on `UpNextScreen` and `ActiveWorkoutScreen` open it; `UpNextScreen` then calls `useReplaceRecommendationExercise` (`POST /api/workout-recommendations/replace`) and writes the server's re-prescribed workout straight into the cache, while `ActiveWorkoutScreen` swaps the entry in the local session store.
- Rest duration is configurable per exercise via `RestPeriodChip` / `RestPeriodSheet` and is forwarded through `buildExercisesPayload`. New exercises/sets and null `rest_time` fallbacks seed from the `defaultRestSec` app preference via `getDefaultRestSec()` (Settings → Workout Settings), not a hardcoded constant.
- Fasting uses `FastingDetailScreen`, `FastingCard`, `FastingProtocolSheet`, `useFasting`, `useFastingTimer`, `utils/fasting.ts`, and `services/api/fastingApi.ts`.
- `FastingGoalReconciler` is mounted headlessly on `DashboardScreen`; it owns goal-notification reconciliation and app-resume refetch even when the visible fasting card is hidden.
- Fasting goal notifications are gated by the app notifications toggle; ending/canceling a fast clears scheduled notifications.

## Medications

- The cabinet is `MedicationsList` (reached from a row on `DashboardScreen`), `MedicationDetail`, `MedicationFormScreen` and `MedicationScheduleFormScreen`, over `services/api/medicationsApi.ts` and `hooks/useMedications.ts`.
- The name field is a **three-tier search**, and the tiers are ranked by how much they know about *this* user: tier 1 is their own cabinet, tier 2 the bundled catalog in `@workspace/shared` (`searchCatalog`, offline, the peptides this app is built around), tier 3 the US drug catalog (NLM RxTerms) over the network. `MedicationNameSuggestions` renders all three and reports a `MedicationNamePick`; it applies nothing — `MedicationFormScreen.handleNamePick` owns which fields a pick fills in. The web combobox mirrors this pick type deliberately, so a change to one is a change to both.
- **Tier 3 is opt-in and silent.** `hooks/useMedicationCatalogSearch.ts` gates every request on `medication_catalog_lookup_enabled`, a 250 ms debounce and `RXTERMS_MIN_TERM_LENGTH`; the server gate is the binding one, but the client not asking is what keeps the medication name on the device. It answers with an empty list for every failure — no toast, no error state, no retry — because tiers 1 and 2 have already rendered and adding a medication must never depend on the NIH being reachable. The `active` flag exists for the edit case: the form opens with a name already in the field, and `useDebounce` seeds from it, so without it opening a row to fix a typo would send that drug's name to NLM.
- Where the two catalogs overlap, **tier 2 wins** — the server drops any RxTerms product the curated catalog resolves, because RxTerms describes those drugs as pen concentrations rather than as the dose the pen's dial says. Tier 1 suppression is the client's job and matches on `baseName`.
- A tier 3 row is a **product**, not a strength: one row per product with a hint from `rxTermsStrengthHint` (shared, so both platforms make the same call), and a product with several strengths asks in the form afterwards rather than guessing. `rxnorm_rxcui` is stored from the strength picked, never the product, and is cleared the moment the name stops describing it.
- **Tier 1 is ranked by use, not by alphabet.** `rankOwnMedications` (shared) orders the cabinet active-first, then most recently taken, then the never-taken alphabetically, and only then applies the three-row cap — a user with a dozen matches was otherwise offered whichever three sorted first. It reads `last_taken_at`, a **derived** field only the list endpoint fills in.
- **A tier 2 group can be a guess.** When `searchCatalog` matches nothing by substring it falls back to edit distance and flags the hits `viaTypo`; the heading then says "Did you mean" rather than "Known drugs". Tier 3 says the same in words: `correctedTerms` from the server names the spellings its rows were actually found under, rendered as a sub-line under the NLM row, because RxNav answers a metformin typo with merbromin as well as metformin.
- The opt-in lives on `MedicationSettingsScreen` (Settings → Medications), worded the same as the web row because both set one server-side preference. There is deliberately no nudge inside the suggestion list.
- `components/ReconstitutionCalculator.tsx` is the vial-mixing calculator. The arithmetic is not here: it and the web component of the same name both call the one shared `reconstitute()`, so neither platform can drift into its own numbers, and `onApply` hands back a `ReconstitutionRecord` for `MedicationFormScreen` to persist under `custom_fields.reconstitution` — a concentration alone cannot say whether it came from a 30 mg vial in 3 mL or a 10 mg one in 1 mL.
- The **diluent** is the one place the two platforms present differently on purpose. The record stores one of four values (`bacteriostatic_water` / `bacteriostatic_saline` / `sterile_water` / `sterile_saline`); the web offers them as a single four-option select, and mobile as **two** `SegmentedControl`s — preservative, then fluid — composed through `DILUENT_PARTS` / `DILUENT_BY_PARTS`. `SegmentedControl` is a non-wrapping `flex-row` with `flex-1` children, so "Bacteriostatic 0.9% sodium chloride" in a quarter of a phone's width is unreadable; splitting it also puts the preservative, the half that decides whether the vial has a multi-day beyond-use window at all, on its own control. Do not collapse it back into one four-segment control.
- The draw is drawn: `components/SyringeDiagram.tsx` (`react-native-svg`) renders a barrel filled to `result.syringeUnits` above the number, because a unit count is easy to misread and hard to picture. The geometry is `syringeBarrel()` in shared, so this and the web component of the same name mark their barrels identically. It takes `result.syringeCapacityUnits` rather than re-deriving capacity from the standard; an over-capacity draw renders as a **full** barrel in the warning tone with the un-clamped number still in the accessibility label; and a `null` from `syringeBarrel` renders nothing. The `Svg` has no intrinsic height, so the wrapping `View` fixes the aspect ratio or it collapses to nothing — the same trap `MuscleBodyMap` documents. In tests, an SVG `Text` renders as `RNSVGText` and its string child is **not** reachable by `getByText`; query `UNSAFE_getAllByType(Text)` from `react-native-svg` and read `props.children`. Colours cannot be asserted at all here: `jest.setup.js` answers every `useCSSVariable` with one grey, so the tone half is covered by the web suite.
- The field is `ReconstitutionDiluent | **null**` — absent, null, and an unrecognised value all read back as "not stated" — because it was added after mixes were already saved and `readReconstitutionRecord` is otherwise all-or-nothing. The picker opens on bacteriostatic water for a record that does not state one, which is a default the user can change, not a claim the record makes.

## Dashboard, Diary, Measurements, And Nutrients

- `DashboardScreen` and `DiaryScreen` share date navigation patterns and support gesture-driven date movement.
- `DashboardScreen` drives hydration quick-add, card visibility, fasting summary, health trends, and widget sync.
- `DiaryScreen` owns meal type sections, measurement summaries, serving quick-adjust, swipe/long-press deletes, and AddSheet date propagation.
- `DashboardSettingsScreen` controls dashboard card visibility and custom nutrient display preferences.
- Custom nutrients are fetched via `useCustomNutrients` from `GET /api/custom-nutrients`; nutrient display preferences use full-array replace through `preferencesApi.ts`.
- Nutrient metadata and defaults live in `constants/nutrients.ts`; aggregation and visibility toggling live in `utils/nutrientUtils.ts`.
- Measurements and water routes are in `measurementsApi.ts`; date-sensitive flows should preserve calendar-day strings and shared timezone helpers.

## Chat (Ask Sparky)

- `Chat` is a root-stack route (`src/screens/ChatScreen.tsx`), reached from `AddSheet`'s "Ask Sparky" row and an optional dashboard card gated by the `askSparkyVisible` preference.
- The thread is an assistant-ui runtime: `@assistant-ui/react-native` primitives plus `useChatRuntime` / `AssistantChatTransport` from `@assistant-ui/react-ai-sdk`, streaming from `POST /api/chat/stream` (AI SDK UI message stream protocol).
- The transport must use `expo/fetch` — it exposes a real `ReadableStream` body. RN's global fetch buffers responses and silently breaks incremental streaming.
- Auth and proxy headers are resolved per request through an async `headers` callback; `service_config_id` (the user's active AI provider) is merged into the request body and required by the server.
- `chatApi.ts` is history persistence only: `GET /api/chat/sparky-chat-history` and `POST /api/chat/clear-all-history`. `useChatHistory` seeds the runtime with prior messages and uses `staleTime`/`gcTime` of 0 because the runtime ignores `messages` changes after mount — every chat open must re-seed cold.
- Chat UI lives in `components/chat/`: `MarkdownMessage` (`react-native-enriched-markdown` + `remend` to repair unclosed streamed markdown), `ToolCallCard` (derives running/complete/error from `result`/`isError`), `TypingIndicator`. Tool-name display mapping lives in `constants/chat.ts`.
- There is no chat Zustand store; thread state lives in the assistant-ui runtime and history seeding in React Query.

## Auth, Networking, And Settings

- Server configs support `apiKey` and `session` auth. URLs/IDs are in AsyncStorage; API keys, session tokens, and proxy headers are in SecureStore.
- `OnboardingScreen` handles first-run setup, session sign-in, API keys, MFA, theme, external food source defaults, and finish-without-connection.
- `ServerSettingsScreen` handles server list management, active server switching, connection tests, web dashboard launch, and `ServerConfigModal`.
- `useAuth`, `ReauthModal`, `ServerConfigModal`, `authService.ts`, and `MfaForm` coordinate auth recovery, MFA, session expiry, and API-key fallback.
- Production rejects HTTP server URLs. Preserve HTTPS guards in onboarding, settings, raw fetch paths, and health sync.
- Proxy headers support reverse-proxy auth. They must be injected before auth headers in `apiClient.ts` and raw fetch clients.
- During login before a config is saved, `authService` manages pending proxy headers via `setPendingProxyHeaders()` / `clearPendingProxyHeaders()`.
- Prefer `getApiErrorMessage` / API error helpers over ad hoc error parsing in UI.

## Logging And Diagnostics

- `LogService.ts` is the single source of truth for app logs. Prefer `addLog(message, status?, details?)` over `console.*`.
- Valid log statuses are `DEBUG`, `INFO`, `WARNING`, and `ERROR`. Legacy `SUCCESS` is migrated to `INFO` on read.
- Capture and view filtering are separate thresholds; do not conflate storage filtering with `LogScreen` filtering.
- Use structured `details` arrays for diagnostic context instead of cramming multiline strings into `message`.
- `diagnosticReportService.ts` and `healthDiagnosticService.ts` power diagnostic exports. Android-only raw Health Connect diagnostics belong in `healthDiagnosticService.ts`.

## Styling And UI

- Styling uses Uniwind with TailwindCSS v4 tokens in `global.css`.
- Themes are Light, Dark, AMOLED, and System. `themeService.ts` owns persistence; `App.tsx` syncs Android navigation bar style.
- Many visual components read CSS variables with `useCSSVariable`, especially Skia charts and themed controls.
- Animate Skia paths from Reanimated `useSharedValue` / `useDerivedValue`, not Skia's deprecated animation API.
- `Icon.tsx` maps semantic names to SF Symbols on iOS and Ionicons on Android; verify identifiers before adding icons.
- Use shared primitives where they fit: `FormInput`, `Button`, `SettingsRow`, `SettingsRowGroup`, `SegmentedControl`, `StepperInput`, `BottomSheetPicker`, `CalendarSheet`, `DateRangeSheet`, `AnchoredMenu`, and `FormScreenChrome`.
- `BottomSheetPicker`, `CalendarSheet`, and sheets shown over native modals use `FullWindowOverlay` on iOS to avoid nested-provider inset bugs.
- Keep button text and compact cards within their stable dimensions across mobile sizes. Avoid layout shifts from dynamic labels, loading states, or icon swaps.

## Widgets And Native Config

- iOS widgets live under `targets/widget/`, share data through the app group from `app.identifiers.js`, and reload through `ExtensionStorage` in `useWidgetSync`.
- Current iOS widgets are calorie and macro widgets. When changing display, update Swift views, shared helpers, TS snapshot shape, and reload kind handling together.
- Android widgets live under `targets/android-widget/`. `plugins/withCalorieWidget.ts` copies Kotlin/templates/resources, registers receivers, wires the native module package, and documents the pattern for adding another widget.
- `src/services/CalorieWidgetBridge.ts` is the JS bridge for Android widget snapshot writes and Glance reloads.
- The scheduled "Rest complete" alert fires exactly only with the `SCHEDULE_EXACT_ALARM` special access ("Alarms & reminders", user-granted, denied by default on Android 13+) — without it expo-notifications falls back to inexact alarms the OS batches ~15s late. The `targets/android-exact-alarm/` Kotlin module (registered by `plugins/withExactAlarmModule.ts`) exposes `canScheduleExactAlarms`/`openExactAlarmSettings` through `src/services/ExactAlarmBridge.ts`; `maybePromptForExactAlarmPermission` in `notifications.ts` owns the one-time grant prompt at workout start.
- Widget snapshot shape is owned by `useWidgetSync.ts`; keep it aligned with Swift views and Kotlin composables.
- The workout Live Activity (Lock Screen + Dynamic Island elapsed/rest timers) uses `expo-widgets`, whose generated `ExpoWidgetsTarget` extension coexists with the `@bacons/apple-targets` `targets/widget/` target. `src/services/WorkoutLiveActivityLayout.tsx` is the `'widget'`-directive layout (self-contained; only `@expo/ui/swift-ui` imports; epoch-ms props, never `Date`s) and must only be imported from `src/services/workoutLiveActivity.ios.ts` — `createLiveActivity` runs at module scope and would drag iOS native modules into the Android bundle. The `.ios.ts` service subscribes to `activeWorkoutStore` (ops held until persist hydration + instance reconcile) and serializes all start/update/end calls; the OS ticks the timers from absolute timestamps, no polling — the app pushes an update only on a real state change. The rest "+15s"/"Skip" and active-phase "Complete" buttons (iOS 17+; inert below 17) fire a `LiveActivityIntent` that runs in the app process and lands in the service via `addUserInteractionListener`, which dispatches to store actions; the button `target` strings are duplicated by hand between layout and service because the `'widget'` body cannot import them. A press after a force-quit is lost (the event fires before JS boots). The rest progress bar is an OS-ticked `ProgressView timerInterval`; the `bannerSmall` slot targets the watchOS Smart Stack/CarPlay and stays button-free. Live Activities get NO `widgets[]` entry in `app.config.ts` (that array is only for home/Lock Screen widgets).
- `app.config.ts` controls bundle identifiers, Apple team IDs, iOS app group, Android permissions, navigation bar contrast, widget plugins, and production-only network security config.
- `APP_VARIANT` selects dev vs production behavior; dev builds request extra Android Health Connect write permissions for local testing/seeding.
- After editing `targets/`, native config plugins, app groups, permissions, or native bridge shape, run `npx expo prebuild --clean`.

## Shared Workspace Contracts

- `@workspace/shared` lives at `../shared/` and is source-first in this workspace.
- Prefer shared schemas and constants for API request/response contracts, exercise/workout types, precision constants, calorie constants, and timezone utilities.
- Keep `YYYY-MM-DD` values as calendar-day strings until a database or external API boundary requires UTC instants.
- For day-string logic, prefer shared timezone helpers such as `isDayString`, `addDays`, `compareDays`, `localDateToDay`, `todayInZone`, `instantToDay`, `dayToUtcRange`, and `dayRangeToUtcRange`.
- Mobile API contract changes usually require matching server and often web checks. Food photo, shared schemas, nutrition, meal copy, and auth changes are common cross-package surfaces.

## Server API Orientation

All endpoints require auth headers, and proxy headers are injected before auth headers when configured. Key mobile clients:

- `healthDataApi.ts` - `POST /api/health-data`, identity checks, chunking, timeout, retry, session-expiry handling.
- `dailySummaryApi.ts`, `goalsApi.ts`, `measurementsApi.ts`, `preferencesApi.ts` - daily summary, goals, check-ins, water, timezone bootstrap, nutrient display preferences.
- `foodEntriesApi.ts`, `foodEntryMealsApi.ts`, `foodsApi.ts`, `mealsApi.ts`, `mealTypesApi.ts` - diary food entries, grouped logged meals, saved foods/variants/barcodes, saved meals, meal types.
- `externalFoodSearchApi.ts`, `aiSettingsApi.ts`, `aiConversionApi.ts` - provider-agnostic food search/details/barcode, label/photo estimate, AI availability, unit conversion.
- `exerciseApi.ts`, `externalExerciseSearchApi.ts`, `workoutPresetsApi.ts` - exercise history, suggested/search/import flows, preset/individual exercise sessions, workout presets.
- `fastingApi.ts` - `POST /api/fasting/start`, `POST /api/fasting/end`, and current/stats/history reads.
- `authService.ts`, `profileApi.ts`, `externalProvidersApi.ts`, `customNutrientsApi.ts` - auth/session/MFA, profile, configured providers, custom nutrient definitions.
- `ChatScreen.tsx` (transport) + `chatApi.ts` - streaming chat via `POST /api/chat/stream`, history load/clear.

When reviewing an API issue, trace screen/hook -> API client -> server route -> service/repository -> shared schema before judging the fix. Deeper endpoint docs live in mobile `docs/` (`food_api.md`, `sync_api.md`, `measurements_api.md`, `external_providers.md`, `healthkit.md`, `bg_sync.md`).

## Localization And Reactive Helpers

- React UI gets `t` from `useTranslation()`; user-facing utility helpers accept an injected `TFunction` and never hide singleton `i18n.t()` fallbacks.
- Pass `t` through every presentation helper and include it in `useMemo` / `useCallback` dependencies when the derived result contains localized text; this keeps mounted UI correct after a runtime language switch.
- Translation keys are semantic and statically analyzable. Every static `defaultValue` is the English source fallback and must exactly match the EN catalog entry.
- A key used with `count` is a plural family: EN requires `_one` and `_other`; PL requires `_one`, `_few`, `_many`, and `_other`. Use grammatically correct forms rather than duplicating suffixes blindly.
- Run `pnpm run i18n:audit` after localization work. `pnpm run validate` includes typecheck, lint with zero warnings, and this audit.
- Two of the audit's rules are **informational here and blocking upstream**: `hardcoded-ui-text` (~248 findings) and `manual-pluralization` (4). Both describe one backlog — the exercise/workout screens (Up Next, gym profiles, muscle picking, weekly set targets, exercise packs) predate the localization contract and have never been translated — so blocking on them would gate every unrelated change on that migration, and localizing only the plural noun inside an otherwise-hardcoded English sentence is not an improvement. The severity lives in `scripts/i18n-audit/core.cjs` (`hasErrors`); re-check it on every upstream sync, because upstream keeps flipping it back. `locale-unsafe-number-format` stays blocking — it has no backlog.
- Keep canonical storage/API values and user-generated content literal; localize only application-owned presentation labels.

## Testing Guidance

- Tests live in `__tests__/` with `jest-expo`, `jsdom`, and `jest.setup.js`.
- Run related tests for the touched surface, then lint/typecheck for cross-cutting changes.
- Run the full single-run suite after broad refactors, shared mock changes, navigation rewiring, root provider changes, import-path moves, native config changes, public type changes, or global mock edits.
- Be careful with global mocks in `jest.setup.js`; mock pollution can fail unrelated files.
- On macOS, Jest resolves `.ios.ts` by default. Android-specific service tests should require the Android file explicitly:

```ts
const androidService = require('../../src/services/healthConnectService.ts');
```

- Health sync changes: rerun `useSyncHealthData`, `backgroundSyncService`, `healthDataApi`, `healthConnectService`, `healthConnectService.ios`, and relevant `services/healthconnect` / `services/healthkit` tests.
- Health writeback changes: rerun `healthconnect/writeback`, `healthkit/writeback`, writeback mapper tests, `HealthDataWriteback`, `backgroundSyncService`, notifications where relevant, and sync tests.
- Food library/form/unit/barcode changes: rerun `FoodForm`, `FoodUnitSelectorSheet`, `DiaryScreen`, `FoodDetailScreen`, `FoodFormScreen`, `EditBarcodeScreen`, `useFoodsLibrary`, `useFoodVariants`, `useDeleteFood`, `foodsApi`, `foodDetails`, and unit conversion tests.
- Meal template/logged-meal changes: rerun meals library/detail/add/edit screens, `MealTypeDetailScreen`, copy meal tests, food search/entry picker tests, meal hooks/API tests, and meal builder/nutrition utils.
- Exercise/workout/preset changes: rerun exercise/preset library/detail/form/search/mutation tests, workout/activity form and draft tests, active workout store tests, rest-period tests, and `workoutSession` tests.
- Recommendation-family changes ("Up Next", recovery, muscle targeting, on-demand, gym profiles): rerun `UpNextScreen`, `UpNextCard`, `PickMusclesScreen`, `OnDemandWorkoutsScreen`, `ExerciseHomeScreen`, `GymProfilesScreen`, `MuscleRecoveryStrip`, `useMuscleRecovery`, `useWeeklySetTargets`, `workoutRecommendationsApi`, `muscleTiles`, `muscleArt`, and `workoutSession` tests. A new root-stack screen here also has to satisfy `__tests__/navigation/nativeHeaderContract.test.ts`. `hooks/useWorkoutRecommendation.ts`, `hooks/useGymProfiles.ts` and `utils/workoutSupersets.ts` now have direct suites (`__tests__/hooks/useWorkoutRecommendation.test.tsx`, `__tests__/hooks/useGymProfiles.test.tsx`, `__tests__/utils/workoutSupersets.test.ts`) — rerun those alongside the screens rather than relying on screen coverage to catch a change to one of them.
- Medication changes: rerun `MedicationFormScreen`, `MedicationDetailScreen`, `MedicationsListScreen`, `MedicationScheduleFormScreen`, `MedicationNameSuggestions`, `MedicationSettingsScreen`, `useMedicationCatalogSearch`, `MedicationsCard`, and `MedicationReminderReconciler` tests. `useMedicationCatalogSearch` needs fake timers, and its `useFakeTimers`/`useRealTimers` hooks must sit **inside** the `describe` — declared at file scope they run after RNTL's auto-cleanup, which deadlocks under fake timers and times out every test in the file.
- Fasting changes: rerun `FastingCard`, `FastingGoalReconciler`, `FastingDetailScreen`, `useFasting`, `useFastingTimer`, `fastingApi`, notification tests, and fasting utility/constant tests.
- Diary quick-adjust/delete changes: rerun swipe row, serving adjustment, food entry update/delete, meal-type detail, and exercise mutation tests.
- Food scan/photo changes: rerun food scan, food photo flow screens, AI settings/external food APIs, food photo intro, food photo utils, and haptics tests.
- Settings/auth/networking changes: rerun onboarding, server settings, server config modal, auth hooks/services, storage, API client, raw fetch client tests, and proxy-header tests.
- Widgets/HUD/tab/add-sheet changes: rerun `useWidgetSync`, active workout store, `AddSheet`, `CustomTabBar`, `ActiveWorkoutBar`, and error-boundary tests.

## Quick Routing

- Health sync bug: start at `healthConnectService.ts` or `.ios.ts`, then `services/healthconnect/` or `services/healthkit/`, `backgroundSyncService.ts`, `autoSyncCoordinator.ts`, `useSyncHealthData.ts`, `SyncScreen.tsx`, and `healthDataApi.ts`.
- Health writeback bug: inspect `HealthDataWriteback`, `services/writeback.ts` / `.ios.ts`, platform writeback modules, mapper files, tracking storage, app permissions, and inbound source filters.
- Food library/edit bug: inspect `DiaryScreen`, food library/detail/form/barcode screens, `FoodForm`, unit selector, food hooks, `foodsApi`, food unit types, and `foodDetails.ts`.
- Meal bug: inspect meals library/detail/add/edit screens, `MealTypeDetailScreen`, food picker routes, meal hooks/API, selection service, logged-meal API, and meal nutrition utils.
- Exercise/preset bug: inspect library/detail/form/search screens, related hooks/API, selected-exercise handoff, rest-period controls, and workout session helpers.
- Suggested-workout bug ("Up Next", recovery percentages, muscle targeting, on-demand themes): the surfaces are `UpNextCard` and `ExerciseHomeScreen` (entry points), `UpNextScreen` (the workout itself, its swap sheet and its ⋯ menu), `PickMusclesScreen` and `OnDemandWorkoutsScreen` (the two pickers, both on `useGenerateAndShowWorkout`), `MuscleRecoveryStrip`, and `GymProfilesScreen`. They share one client, `services/api/workoutRecommendationsApi.ts`, and one cached row keyed by `workoutRecommendationQueryKey` — there is at most one stored recommendation per user, and generate/replace write the server's response straight into that cache instead of invalidating. Nothing about the *content* of a workout is decided on the client: duration, target muscles and gym profile are request parameters, and sets, loads, rests and warm-ups all come back from the server. Before suspecting mobile, check whether the payload already carried what you are seeing (`SparkyFitnessServer/AGENTS.md` routes the server half). The two client-side exceptions are superset grouping, which is local screen state applied at start-workout, and the canonical↔mobile set-type mapping in `utils/workoutSession.ts`.
- Workout/activity/HUD bug: inspect `AddSheet`, workout/activity screens, workout form hooks, `workoutDraftService`, `activeWorkoutStore`, `ActiveWorkoutBar`, rest notifications, and detail screen set interactions.
- Medication name autofill bug (a suggestion missing, a wrong strength, a name that should not have been sent): start at `MedicationNameSuggestions`, then `hooks/useMedicationCatalogSearch.ts` and `MedicationFormScreen.handleNamePick`. Tiers 1-2 are pure and local, so a missing row there is `searchCatalog`; anything about tier 3's *content* is decided in `shared/src/medications/rxterms.ts` and on the server, not here.
- Fasting bug: inspect `FastingDetailScreen`, `FastingCard`, `FastingGoalReconciler`, `useFasting`, `useFastingTimer`, `fastingApi`, `notifications`, and card visibility preferences.
- Measurements/hydration bug: inspect dashboard/diary/measurements screens, summaries/gauges, measurement/water/check-in hooks, API, date helpers, widget sync, writeback, and unit conversions.
- Scan/photo bug: inspect food scan/search, `FoodPhotoFlow`, photo screens, AI setting hook/API, estimate hook/API, intro persistence, haptics, icon usage, and route params.
- Widget/deep-link bug: inspect `useWidgetSync`, `CalorieWidgetBridge`, widget targets, widget plugins, `app.config.ts`, `app.identifiers.js`, `App.tsx`, and dashboard.
- Settings/diagnostics bug: inspect settings screens, `SettingsRow`, haptics/theme/sounds/notification services, diagnostics services, `DevTools`, and screen error boundaries.

## Priority Rule

- For work inside `SparkyFitnessMobile/`, this file is the package guide.
- If a task also changes another package, combine this with that package guide instead of stretching this file to cover the whole monorepo.
