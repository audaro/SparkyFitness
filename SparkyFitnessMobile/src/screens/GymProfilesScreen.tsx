import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EQUIPMENT, isKnownEquipment, type Equipment } from '@workspace/shared';

import FormInput from '../components/FormInput';
import Icon from '../components/Icon';
import Button from '../components/ui/Button';
import Switch from '../components/ui/Switch';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useGymProfiles, useGymProfileMutations } from '../hooks/useGymProfiles';
import type { GymProfile } from '../services/api/gymProfilesApi';
import type { RootStackScreenProps } from '../types/navigation';

type GymProfilesScreenProps = RootStackScreenProps<'GymProfiles'>;

/**
 * Display-only capitalization. Stored values stay canonical lowercase — the
 * catalog matches them with `equipment::jsonb ?|`, which is exact and
 * case-sensitive, so a title-cased value would quietly match nothing.
 */
function equipmentLabel(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function equipmentSummary(t: TFunction, equipment: string[]): string {
  if (equipment.length === 0)
    return t('gymProfiles.noEquipment', { defaultValue: 'No equipment selected' });
  return equipment.map(equipmentLabel).join(', ');
}

/**
 * The response type is `string[]` (the server does not re-narrow it on the way
 * out), but the create/update payloads only accept canonical values. Dropping
 * anything unknown here keeps a stale row from making every later save fail
 * validation.
 */
function toCanonicalList(equipment: string[]): Equipment[] {
  return equipment.filter((value): value is Equipment => isKnownEquipment(value));
}

interface EditorState {
  /** null while creating; the profile being edited otherwise. */
  profile: GymProfile | null;
  name: string;
  equipment: Equipment[];
  makeActive: boolean;
}

const GymProfilesScreen: React.FC<GymProfilesScreenProps> = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const [accentPrimary, textMuted, textSecondary] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
    '--color-text-secondary',
  ]) as [string, string, string];

  const { profiles, isLoading } = useGymProfiles();
  const {
    createProfileAsync,
    updateProfileAsync,
    deleteProfileAsync,
    activateProfileAsync,
    isSaving,
    isActivating,
  } = useGymProfileMutations();

  const [editor, setEditor] = useState<EditorState | null>(null);

  const openCreate = useCallback(() => {
    setEditor((current) =>
      current
        ? current
        : {
            profile: null,
            name: '',
            equipment: [],
            // A first profile that is not active would change nothing, so
            // default it on; later ones are created inactive until switched to.
            makeActive: profiles.length === 0,
          },
    );
  }, [profiles.length]);

  const openEdit = useCallback((profile: GymProfile) => {
    setEditor({
      profile,
      name: profile.name,
      equipment: toCanonicalList(profile.equipment),
      makeActive: profile.is_active,
    });
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const toggleEquipment = useCallback((value: Equipment) => {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        equipment: current.equipment.includes(value)
          ? current.equipment.filter((item) => item !== value)
          : [...current.equipment, value],
      };
    });
  }, []);

  const trimmedName = editor?.name.trim() ?? '';
  const canSave = trimmedName.length > 0 && !isSaving;

  const handleSave = useCallback(async () => {
    if (!editor || editor.name.trim().length === 0) return;
    const name = editor.name.trim();
    try {
      if (editor.profile) {
        await updateProfileAsync({
          id: editor.profile.id,
          payload: { name, equipment: editor.equipment },
        });
        // Activation is its own server-side transaction (it clears the
        // previous active row), so a profile switched on while editing needs
        // a second call.
        if (editor.makeActive && !editor.profile.is_active) {
          await activateProfileAsync(editor.profile.id);
        }
      } else {
        await createProfileAsync({
          name,
          equipment: editor.equipment,
          is_active: editor.makeActive,
        });
      }
      setEditor(null);
    } catch {
      // The mutation hooks already toast; keep the editor open so the entered
      // values are not lost.
    }
  }, [editor, updateProfileAsync, activateProfileAsync, createProfileAsync]);

  const handleDelete = useCallback(() => {
    const profile = editor?.profile;
    if (!profile) return;
    Alert.alert(
      t('gymProfiles.deleteTitle', { defaultValue: 'Delete gym profile' }),
      t('gymProfiles.deleteMessage', {
        defaultValue:
          'Delete "{{name}}"? Workouts you have already logged are not affected.',
        name: profile.name,
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: () => {
            void deleteProfileAsync(profile.id)
              .then(() => setEditor(null))
              .catch(() => {
                // Toasted by the mutation hook.
              });
          },
        },
      ],
    );
  }, [t, editor, deleteProfileAsync]);

  const handleActivate = useCallback(
    (profile: GymProfile) => {
      if (profile.is_active || isActivating) return;
      void activateProfileAsync(profile.id).catch(() => {
        // Toasted by the mutation hook.
      });
    },
    [activateProfileAsync, isActivating],
  );

  // One primary action at a time: the editor owns Save, the list owns the add
  // button (a plain icon), so the one-accent invariant holds in both modes.
  const editorTitle = editor
    ? editor.profile
      ? t('gymProfiles.editTitle', { defaultValue: 'Edit Gym Profile' })
      : t('gymProfiles.newTitle', { defaultValue: 'New Gym Profile' })
    : t('gymProfiles.listTitle', { defaultValue: 'Gym Profiles' });

  const header = useScreenHeader({
    title: editorTitle,
    nativeTitle: editorTitle,
    animateKey: editor ? 'edit' : 'list',
    nativeOptions: { gestureEnabled: !editor, headerBackVisible: !editor },
    left: editor
      ? {
          kind: 'dismiss',
          onPress: closeEditor,
          disabled: isSaving,
          accessibilityLabel: t('common.cancel', { defaultValue: 'Cancel' }),
          identifier: 'gym-profiles-cancel',
        }
      : { kind: 'back' },
    right: editor
      ? {
          kind: 'primary',
          label: t('common.save', { defaultValue: 'Save' }),
          onPress: () => void handleSave(),
          disabled: !canSave,
          busy: isSaving,
          identifier: 'gym-profiles-save',
        }
      : {
          kind: 'icon',
          sfSymbol: 'plus',
          ionicon: 'add',
          onPress: openCreate,
          accessibilityLabel: t('gymProfiles.add', { defaultValue: 'Add gym profile' }),
          identifier: 'gym-profiles-add',
        },
  });

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
        keyboardShouldPersistTaps="handled"
      >
        {editor ? (
          <View testID="gym-profile-editor">
            <Text className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">
              {t('gymProfiles.nameLabel', { defaultValue: 'Name' })}
            </Text>
            <FormInput
              value={editor.name}
              onChangeText={(name) =>
                setEditor((current) => (current ? { ...current, name } : current))
              }
              placeholder={t('gymProfiles.namePlaceholder', {
                defaultValue: 'Home, Planet Fitness…',
              })}
              autoCapitalize="words"
              accessibilityLabel={t('gymProfiles.nameA11y', {
                defaultValue: 'Gym profile name',
              })}
              testID="gym-profile-name-input"
            />

            <Text className="text-xs font-bold text-text-secondary uppercase tracking-wider mt-6 mb-1">
              {t('gymProfiles.equipmentLabel', { defaultValue: 'Equipment' })}
            </Text>
            <Text className="text-sm text-text-secondary mb-3">
              {t('gymProfiles.equipmentHelp', {
                defaultValue:
                  'While this profile is active, suggestions only use the equipment you pick here. Bodyweight movements are always available.',
              })}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {EQUIPMENT.map((value) => {
                const selected = editor.equipment.includes(value);
                return (
                  <Pressable
                    key={value}
                    onPress={() => toggleEquipment(value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={equipmentLabel(value)}
                    testID={`gym-profile-equipment-${value}`}
                    className={`flex-row items-center rounded-full px-3 py-2 ${
                      selected ? 'bg-accent-primary' : 'bg-surface'
                    }`}
                  >
                    {selected ? (
                      <View className="mr-1">
                        <Icon name="checkmark" size={14} color="#FFFFFF" />
                      </View>
                    ) : null}
                    <Text
                      className={
                        selected
                          ? 'text-sm font-semibold text-white'
                          : 'text-sm text-text-primary'
                      }
                    >
                      {equipmentLabel(value)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="flex-row items-center justify-between bg-surface rounded-xl p-4 mt-6">
              <View className="flex-1 mr-3">
                <Text className="text-base font-semibold text-text-primary">
                  {t('gymProfiles.useThis', { defaultValue: 'Use this profile' })}
                </Text>
                <Text className="text-sm text-text-secondary mt-0.5">
                  {t('gymProfiles.useThisHelp', {
                    defaultValue: 'Makes it the active profile for workout suggestions.',
                  })}
                </Text>
              </View>
              <Switch
                value={editor.makeActive}
                onValueChange={(makeActive) =>
                  setEditor((current) => (current ? { ...current, makeActive } : current))
                }
                // Turning the active profile off has no meaning — activate a
                // different one instead.
                disabled={editor.profile?.is_active === true}
                accessibilityLabel={t('gymProfiles.useThis', {
                  defaultValue: 'Use this profile',
                })}
              />
            </View>

            {editor.profile ? (
              <Button
                variant="destructive"
                onPress={handleDelete}
                className="mt-6"
                accessibilityLabel={t('gymProfiles.deleteTitle', {
                  defaultValue: 'Delete gym profile',
                })}
                testID="gym-profile-delete"
              >
                {t('gymProfiles.deleteAction', { defaultValue: 'Delete profile' })}
              </Button>
            ) : null}
          </View>
        ) : (
          <View testID="gym-profile-list">
            {isLoading ? (
              <ActivityIndicator
                accessibilityLabel={t('gymProfiles.loading', {
                  defaultValue: 'Loading gym profiles',
                })}
              />
            ) : profiles.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-base font-semibold text-text-primary mb-1">
                  {t('gymProfiles.emptyTitle', { defaultValue: 'No gym profiles yet' })}
                </Text>
                <Text className="text-sm text-text-secondary text-center mb-6">
                  {t('gymProfiles.emptySubtitle', {
                    defaultValue:
                      'Create one for each place you train so workouts only use equipment you actually have.',
                  })}
                </Text>
                <Button onPress={openCreate} testID="gym-profile-empty-create">
                  {t('gymProfiles.add', { defaultValue: 'Add gym profile' })}
                </Button>
              </View>
            ) : (
              <>
                <Text className="text-sm text-text-secondary mb-3">
                  {t('gymProfiles.listHelp', {
                    defaultValue:
                      'Tap a profile to make it active. With no active profile, every exercise is fair game.',
                  })}
                </Text>
                {profiles.map((profile) => (
                  <View
                    key={profile.id}
                    className="flex-row items-center bg-surface rounded-xl p-4 mb-2 shadow-sm"
                  >
                    <Pressable
                      className="flex-1 flex-row items-center"
                      onPress={() => handleActivate(profile)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: profile.is_active }}
                      accessibilityLabel={
                        profile.is_active
                          ? t('gymProfiles.rowActiveA11y', {
                              defaultValue: '{{name}}, active',
                              name: profile.name,
                            })
                          : profile.name
                      }
                      testID={`gym-profile-row-${profile.id}`}
                    >
                      <Icon
                        name={
                          profile.is_active
                            ? 'checkmark-circle-filled'
                            : 'radio-button-off'
                        }
                        size={22}
                        color={profile.is_active ? accentPrimary : textMuted}
                      />
                      <View className="flex-1 ml-3 mr-2">
                        <Text
                          className="text-base font-semibold text-text-primary"
                          numberOfLines={1}
                        >
                          {profile.name}
                        </Text>
                        <Text className="text-sm text-text-secondary mt-0.5" numberOfLines={2}>
                          {equipmentSummary(t, profile.equipment)}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => openEdit(profile)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={t('gymProfiles.editRowA11y', {
                        defaultValue: 'Edit {{name}}',
                        name: profile.name,
                      })}
                      testID={`gym-profile-edit-${profile.id}`}
                    >
                      <Icon name="pencil" size={20} color={textSecondary} />
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default GymProfilesScreen;
