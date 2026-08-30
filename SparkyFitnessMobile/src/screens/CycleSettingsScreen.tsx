import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useCycleSettings } from '../hooks/useCycleSettings';
import { useDiscreetMode } from '../hooks/useDiscreetMode';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { addLog } from '../services/LogService';
import { useScreenHeader } from '../hooks/useScreenHeader';
import type { RootStackScreenProps } from '../types/navigation';
import BottomSheetPicker from '../components/BottomSheetPicker';
import StepperInput, { useStepperDraft } from '../components/StepperInput';
import Switch from '../components/ui/Switch';
import { CYCLE_SETTING_LIMITS, UNCONFIGURED_CYCLE_SETTINGS } from '../utils/cycleDisplayUtils';

import {
  BIRTH_CONTROL_METHODS,
  CYCLE_CONDITIONS,
  CYCLE_DEFAULTS,
  type CycleMode,
} from '@workspace/shared';
import { getExport } from '../services/api/cycleApi';

type CycleSettingsScreenProps = RootStackScreenProps<'CycleSettings'>;

const CycleSettingsScreen: React.FC<CycleSettingsScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const {
    settings,
    isLoading,
    isError,
    refetch,
    updateSettings,
  } = useCycleSettings();

  // The server answers `null` — not a 404, and not an empty object — for an
  // account that has never stored cycle settings, which is every account until
  // this screen writes the first row. Treating that as "still loading" left a
  // spinner with no header and therefore no way back, and since this screen is
  // the only route to CycleOnboarding and the Cycle Hub (the dashboard card
  // that links to them renders nothing while there is no row), it also made the
  // whole feature unreachable. A missing row is a real answer: show the screen
  // with nothing configured yet.
  const effectiveSettings = settings ?? UNCONFIGURED_CYCLE_SETTINGS;

  const modeOptions = [
    { value: 'standard' as const, label: t('cycleSettings.mode.standard', { defaultValue: 'Standard Cycle' }) },
    { value: 'ttc' as const, label: t('cycleSettings.mode.ttc', { defaultValue: 'Trying to Conceive' }) },
    { value: 'pregnant' as const, label: t('cycleSettings.mode.pregnant', { defaultValue: 'Pregnancy Tracking' }) },
    { value: 'postpartum' as const, label: t('cycleSettings.mode.postpartum', { defaultValue: 'Postpartum' }) },
    { value: 'menopause' as const, label: t('cycleSettings.mode.menopause', { defaultValue: 'Menopause-aware' }) },
  ];
  const getBirthControlLabel = (value: (typeof BIRTH_CONTROL_METHODS)[number]['value'], fallback: string) => {
    switch (value) {
      case 'none': return t('cycleSettings.birthControl.none', { defaultValue: 'None' });
      case 'pill': return t('cycleSettings.birthControl.pill', { defaultValue: 'Pill' });
      case 'iud_hormonal': return t('cycleSettings.birthControl.iudHormonal', { defaultValue: 'Hormonal IUD' });
      case 'iud_copper': return t('cycleSettings.birthControl.iudCopper', { defaultValue: 'Copper IUD' });
      case 'implant': return t('cycleSettings.birthControl.implant', { defaultValue: 'Implant' });
      case 'ring': return t('cycleSettings.birthControl.ring', { defaultValue: 'Ring' });
      case 'patch': return t('cycleSettings.birthControl.patch', { defaultValue: 'Patch' });
      case 'shot': return t('cycleSettings.birthControl.shot', { defaultValue: 'Shot' });
      case 'condoms': return t('cycleSettings.birthControl.condoms', { defaultValue: 'Condoms / barrier' });
      case 'other': return t('cycleSettings.birthControl.other', { defaultValue: 'Other' });
      default: return fallback;
    }
  };
  const bcOptions = BIRTH_CONTROL_METHODS.map((method) => ({
    value: method.value,
    label: getBirthControlLabel(method.value, method.displayName),
  }));
  const getConditionLabel = (value: string, fallback: string) => {
    switch (value) {
      case 'pcos': return t('cycleSettings.condition.pcos', { defaultValue: 'PCOS' });
      case 'endometriosis': return t('cycleSettings.condition.endometriosis', { defaultValue: 'Endometriosis' });
      case 'fibroids': return t('cycleSettings.condition.fibroids', { defaultValue: 'Fibroids' });
      case 'thyroid': return t('cycleSettings.condition.thyroid', { defaultValue: 'Thyroid condition' });
      case 'other': return t('cycleSettings.condition.other', { defaultValue: 'Other' });
      default: return fallback;
    }
  };
  const terminologyOptions = [
    { value: 'default' as const, label: t('cycleSettings.terminology.default', { defaultValue: 'Default' }) },
    { value: 'neutral' as const, label: t('cycleSettings.terminology.neutral', { defaultValue: 'Gender-Neutral' }) },
  ];

  const handleToggleEnabled = useCallback((value: boolean) => {
    updateSettings({ enabled: value, mark_onboarded: value ? true : undefined });
  }, [updateSettings]);

  const handleModeChange = useCallback((value: string) => {
    updateSettings({ mode: value as CycleMode });
  }, [updateSettings]);

  const handleBcChange = useCallback((value: string) => {
    updateSettings({ birth_control_method: value });
  }, [updateSettings]);

  const handleToggleCondition = useCallback((condition: string, active: boolean) => {
    const conditions = [...(effectiveSettings.conditions || [])];
    if (active) {
      if (!conditions.includes(condition)) {
        conditions.push(condition);
      }
    } else {
      const idx = conditions.indexOf(condition);
      if (idx >= 0) {
        conditions.splice(idx, 1);
      }
    }
    updateSettings({ conditions });
  }, [effectiveSettings, updateSettings]);

  const handleToggleFertileWindow = useCallback((value: boolean) => {
    updateSettings({ show_fertile_window: value });
  }, [updateSettings]);

  const handleToggleDiscreetMode = useCallback((value: boolean) => {
    updateSettings({ discreet_mode: value });
  }, [updateSettings]);

  const handleTerminologyChange = useCallback((value: string) => {
    updateSettings({ terminology: value as 'default' | 'neutral' });
  }, [updateSettings]);

  const handleResetOnboarding = useCallback(() => {
    Alert.alert(
      t('cycleSettings.reset.title', { defaultValue: 'Reset Onboarding' }),
      t('cycleSettings.reset.message', { defaultValue: 'Are you sure you want to reset your cycle onboarding? This will clear your setup progress, but your logged cycle days will remain intact.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('cycleSettings.reset.action', { defaultValue: 'Reset' }),
          style: 'destructive',
          onPress: () => {
            updateSettings({ reset_onboarding: true });
            Toast.show({ type: 'success', text1: t('cycleSettings.reset.success', { defaultValue: 'Onboarding reset completed.' }) });
          },
        },
      ]
    );
  }, [t, updateSettings]);

  const handleExportData = useCallback(async () => {
    try {
      Toast.show({ type: 'info', text1: t('cycleSettings.export.preparing', { defaultValue: 'Preparing Export' }), text2: t('cycleSettings.export.generating', { defaultValue: 'Generating JSON export file...' }) });
      const data = await getExport();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `sparky-womens-health-${timestamp}.json`;
      const file = new File(Paths.cache, fileName);
      
      file.create();
      file.write(JSON.stringify(data, null, 2));

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
      });
      file.delete();
    } catch (error) {
      addLog(`Failed to export cycle data: ${error}`, 'ERROR');
      Toast.show({ type: 'error', text1: t('cycleSettings.export.failed', { defaultValue: 'Export Failed' }), text2: t('cycleSettings.export.failedMessage', { defaultValue: 'Could not export cycle data.' }) });
    }
  }, [t]);

  const cycleLengthVal = effectiveSettings.avg_cycle_length_override || CYCLE_DEFAULTS.cycleLength;
  const periodLengthVal = effectiveSettings.avg_period_length_override || CYCLE_DEFAULTS.periodLength;
  const lutealLengthVal = effectiveSettings.luteal_phase_length || CYCLE_DEFAULTS.lutealLength;

  const cycleLengthProps = useStepperDraft({
    value: cycleLengthVal,
    ...CYCLE_SETTING_LIMITS.cycleLength,
    onCommit: (value) => updateSettings({ avg_cycle_length_override: value }),
    onClear: () => updateSettings({ avg_cycle_length_override: null }),
  });

  const periodLengthProps = useStepperDraft({
    value: periodLengthVal,
    ...CYCLE_SETTING_LIMITS.periodLength,
    onCommit: (value) => updateSettings({ avg_period_length_override: value }),
    onClear: () => updateSettings({ avg_period_length_override: null }),
  });

  const lutealLengthProps = useStepperDraft({
    value: lutealLengthVal,
    ...CYCLE_SETTING_LIMITS.lutealLength,
    onCommit: (value) => updateSettings({ luteal_phase_length: value }),
  });

  const { discreetMode } = useDiscreetMode();
  const headerTitle = discreetMode
    ? t('cycleSettings.title.wellness', { defaultValue: 'Wellness Settings' })
    : t('cycleSettings.title.cyclePregnancy', { defaultValue: 'Cycle & Pregnancy' });

  const header = useScreenHeader({
    title: headerTitle,
    nativeTitle: headerTitle,
    left: { kind: 'back' },
  });

  // Both states keep the header, because a screen with no way off it is worse
  // than whatever it is failing to show.
  if (isLoading) {
    return (
      <View
        className="flex-1 bg-background"
        style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
      >
        {header}
        <StatusView loading />
      </View>
    );
  }

  if (isError) {
    return (
      <View
        className="flex-1 bg-background"
        style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
      >
        {header}
        <StatusView
          icon="alert-circle"
          iconTone="danger"
          title={t('cycleSettings.loadFailed', { defaultValue: 'Could not load your settings' })}
          action={{
            label: t('common.retry', { defaultValue: 'Retry' }),
            onPress: () => { refetch(); },
          }}
        />
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
      >
        <SettingsRowGroup>
          <SettingsRow
            title={t('cycleSettings.enable.title', { defaultValue: 'Enable Cycle & Pregnancy Tracking' })}
            subtitle={t('cycleSettings.enable.subtitle', { defaultValue: 'Turn on logging, predictions, and history' })}
            rightAccessory={
              <Switch
                value={effectiveSettings.enabled}
                onValueChange={handleToggleEnabled}
                // A Switch offered as a row's rightAccessory is its own
                // accessibility element, and the row's title is a sibling Text
                // it never sees — so without this VoiceOver announces "off,
                // switch button" with no idea what it controls.
                accessibilityLabel={t('cycleSettings.enable.title', { defaultValue: 'Enable Cycle & Pregnancy Tracking' })}
              />
            }
          />
        </SettingsRowGroup>

        {effectiveSettings.enabled && (
          <>
            <SettingsRowGroup title={t('cycleSettings.groups.features', { defaultValue: 'Feature Configuration' })}>
              <SettingsRow
                title={t('cycleSettings.fields.trackingMode', { defaultValue: 'Tracking Mode' })}
                rightAccessory={
                  <BottomSheetPicker
                    value={effectiveSettings.mode}
                    options={modeOptions}
                    onSelect={handleModeChange}
                    title={t('cycleSettings.pickers.mode', { defaultValue: 'Select Mode' })}
                    containerStyle={{ flex: 1, maxWidth: 200 }}
                  />
                }
              />
              <SettingsRow
                title={t('cycleSettings.fields.birthControl', { defaultValue: 'Birth Control Method' })}
                rightAccessory={
                  <BottomSheetPicker
                    value={effectiveSettings.birth_control_method}
                    options={bcOptions}
                    onSelect={handleBcChange}
                    title={t('cycleSettings.pickers.method', { defaultValue: 'Select Method' })}
                    containerStyle={{ flex: 1, maxWidth: 200 }}
                  />
                }
              />
            </SettingsRowGroup>

            <SettingsRowGroup title={t('cycleSettings.groups.calculations', { defaultValue: 'Cycle Calculations Overrides' })}>
              <SettingsRow
                title={t('cycleSettings.fields.averageCycleLength', { defaultValue: 'Average Cycle Length' })}
                subtitle={effectiveSettings.avg_cycle_length_override ? t('cycleSettings.values.custom', { defaultValue: 'Custom override' }) : t('cycleSettings.values.defaultHistory', { defaultValue: 'Default/History' })}
                rightAccessory={
                  <StepperInput {...cycleLengthProps} keyboardType="number-pad" />
                }
              />
              <SettingsRow
                title={t('cycleSettings.fields.averagePeriodLength', { defaultValue: 'Average Period Length' })}
                subtitle={effectiveSettings.avg_period_length_override ? t('cycleSettings.values.custom', { defaultValue: 'Custom override' }) : t('cycleSettings.values.defaultHistory', { defaultValue: 'Default/History' })}
                rightAccessory={
                  <StepperInput {...periodLengthProps} keyboardType="number-pad" />
                }
              />
              <SettingsRow
                title={t('cycleSettings.fields.lutealLength', { defaultValue: 'Luteal Phase Length' })}
                subtitle={t('cycleSettings.values.lutealSubtitle', { defaultValue: 'Days post-ovulation (default 14)' })}
                rightAccessory={
                  <StepperInput {...lutealLengthProps} keyboardType="number-pad" />
                }
              />
            </SettingsRowGroup>

            <SettingsRowGroup
              title={t('cycleSettings.groups.conditions', { defaultValue: 'Conditions' })}
              subtitle={t('cycleSettings.groups.conditionsSubtitle', { defaultValue: 'Select applicable conditions to personalize your tracking.' })}
            >
              {CYCLE_CONDITIONS.map((cond) => (
                <SettingsRow
                  key={cond.value}
                  title={getConditionLabel(cond.value, cond.displayName)}
                  rightAccessory={
                    <Switch
                      value={effectiveSettings.conditions?.includes(cond.value) || false}
                      onValueChange={(val) => handleToggleCondition(cond.value, val)}
                      accessibilityLabel={getConditionLabel(cond.value, cond.displayName)}
                    />
                  }
                />
              ))}
            </SettingsRowGroup>

            <SettingsRowGroup title={t('cycleSettings.groups.display', { defaultValue: 'Display Options' })}>
              <SettingsRow
                title={t('cycleSettings.fields.showFertileWindow', { defaultValue: 'Show Fertile Window' })}
                subtitle={t('cycleSettings.values.fertileSubtitle', { defaultValue: 'Highlight fertile days on calendar' })}
                rightAccessory={
                  <Switch
                    value={effectiveSettings.show_fertile_window}
                    onValueChange={handleToggleFertileWindow}
                    accessibilityLabel={t('cycleSettings.fields.showFertileWindow', { defaultValue: 'Show Fertile Window' })}
                  />
                }
              />
              <SettingsRow
                title={t('cycleSettings.fields.discreetMode', { defaultValue: 'Discreet Mode' })}
                subtitle={t('cycleSettings.values.discreetSubtitle', { defaultValue: 'Hides \"Cycle\" or \"Pregnancy\" labels in UI' })}
                rightAccessory={
                  <Switch
                    value={effectiveSettings.discreet_mode}
                    onValueChange={handleToggleDiscreetMode}
                    accessibilityLabel={t('cycleSettings.fields.discreetMode', { defaultValue: 'Discreet Mode' })}
                  />
                }
              />
              <SettingsRow
                title={t('cycleSettings.fields.terminology', { defaultValue: 'Terminology' })}
                rightAccessory={
                  <BottomSheetPicker
                    value={effectiveSettings.terminology}
                    options={terminologyOptions}
                    onSelect={handleTerminologyChange}
                    title={t('cycleSettings.pickers.terminology', { defaultValue: 'Select Terminology' })}
                    containerStyle={{ flex: 1, maxWidth: 200 }}
                  />
                }
              />
            </SettingsRowGroup>

            <SettingsRowGroup title={t('cycleSettings.groups.actions', { defaultValue: 'Actions' })}>
              <SettingsRow
                title={t('cycleSettings.fields.export', { defaultValue: 'Export Cycle & Pregnancy Data' })}
                subtitle={t('cycleSettings.values.exportSubtitle', { defaultValue: 'Download JSON data export' })}
                onPress={handleExportData}
              />
              <SettingsRow
                title={t('cycleSettings.fields.reset', { defaultValue: 'Reset Onboarding Wizard' })}
                subtitle={t('cycleSettings.values.resetSubtitle', { defaultValue: 'Restart setup walkthrough' })}
                onPress={handleResetOnboarding}
              />
            </SettingsRowGroup>
          </>
        )}
      </ScrollView>
    </View>
  );
};

export default CycleSettingsScreen;
