import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  EQUIPMENT,
  EXERCISE_APPARATUS,
  isKnownEquipment,
  type Equipment,
  type ExerciseApparatus,
  type GymLoadLimits,
} from '@workspace/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  useActivateGymProfileMutation,
  useCreateGymProfileMutation,
  useDeleteGymProfileMutation,
  useGymProfiles,
  useUpdateGymProfileMutation,
  type GymProfile,
} from '@/hooks/Exercises/useGymProfiles';
import { useCoachingContextAvailable } from '@/hooks/Exercises/useCoachingContextAvailable';
import { usePreferences } from '@/contexts/PreferencesContext';
import { titleCaseCanonical } from '@/utils/canonicalVocabulary';

// Matches gym_equipment_profiles.name, capped by the shared request schema.
const MAX_PROFILE_NAME_LENGTH = 100;

/**
 * The response type is `string[]` (the server does not re-narrow it on the way
 * out) but the create/update payloads only accept canonical values. Dropping
 * anything unknown here keeps a stale row from making every later save fail
 * validation.
 */
function toCanonicalList(equipment: string[]): Equipment[] {
  return equipment.filter((value): value is Equipment =>
    isKnownEquipment(value)
  );
}

/** Same stale-row defense as {@link toCanonicalList}, for apparatus. */
function toCanonicalApparatus(apparatus: string[]): ExerciseApparatus[] {
  return apparatus.filter((value): value is ExerciseApparatus =>
    (EXERCISE_APPARATUS as readonly string[]).includes(value)
  );
}

// Matches the shared request schema's ceiling for load_limits.max_kg.
const MAX_LOAD_LIMIT_KG = 500;

interface EditorState {
  /** null while creating; the profile being edited otherwise. */
  profile: GymProfile | null;
  name: string;
  equipment: Equipment[];
  /**
   * The apparatus field is tri-state: with `apparatusSpecified` off the save
   * writes null ("never stated" — the engine keeps inferring from equipment);
   * on, it writes the checked list exactly, [] included ("stated none").
   */
  apparatusSpecified: boolean;
  apparatus: ExerciseApparatus[];
  /**
   * Heaviest dumbbell, as typed in the user's display unit. Converted to kg
   * only at save time; empty means "no limit" (the dumbbell entry is removed).
   */
  dumbbellMaxInput: string;
  makeActive: boolean;
}

const GymProfilesManager: React.FC = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const enabled = useCoachingContextAvailable();
  const { weightUnit, convertWeight } = usePreferences();

  const { profiles, isLoading, isError, data } = useGymProfiles(enabled);

  const { mutateAsync: createProfile, isPending: isCreating } =
    useCreateGymProfileMutation();
  const { mutateAsync: updateProfile, isPending: isUpdating } =
    useUpdateGymProfileMutation();
  const { mutateAsync: deleteProfile } = useDeleteGymProfileMutation();
  const { mutateAsync: activateProfile, isPending: isActivating } =
    useActivateGymProfileMutation();

  const isSaving = isCreating || isUpdating;

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [profilePendingDeletion, setProfilePendingDeletion] =
    useState<GymProfile | null>(null);

  const openCreate = useCallback(() => {
    setEditor({
      profile: null,
      name: '',
      equipment: [],
      apparatusSpecified: false,
      apparatus: [],
      dumbbellMaxInput: '',
      // A first profile that is not active would change nothing, so default it
      // on; later ones are created inactive until switched to.
      makeActive: profiles.length === 0,
    });
  }, [profiles.length]);

  const openEdit = useCallback(
    (profile: GymProfile) => {
      const dumbbellMaxKg = profile.load_limits?.dumbbell?.max_kg;
      setEditor({
        profile,
        name: profile.name,
        equipment: toCanonicalList(profile.equipment),
        // Array.isArray, not `!== null`: an undefined field (a pre-migration
        // row through a permissive client, or a test fixture) must read as
        // "never stated", the same as SQL NULL.
        apparatusSpecified: Array.isArray(profile.apparatus),
        apparatus: toCanonicalApparatus(profile.apparatus ?? []),
        dumbbellMaxInput:
          dumbbellMaxKg === undefined
            ? ''
            : String(
                Math.round(
                  convertWeight(dumbbellMaxKg, 'kg', weightUnit) * 100
                ) / 100
              ),
        makeActive: profile.is_active,
      });
    },
    [convertWeight, weightUnit]
  );

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

  const toggleApparatus = useCallback((value: ExerciseApparatus) => {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        apparatus: current.apparatus.includes(value)
          ? current.apparatus.filter((item) => item !== value)
          : [...current.apparatus, value],
      };
    });
  }, []);

  /**
   * Parses the dumbbell-max text into kg. Empty is a valid "no limit"; a
   * non-empty value that is not a positive weight inside the schema's ceiling
   * blocks the save rather than being silently dropped or clamped.
   */
  const parseDumbbellMax = useCallback(
    (input: string): { kg: number | null; invalid: boolean } => {
      const trimmed = input.trim();
      if (trimmed === '') return { kg: null, invalid: false };
      const value = Number(trimmed);
      if (!Number.isFinite(value) || value <= 0)
        return { kg: null, invalid: true };
      const kg = Math.round(convertWeight(value, weightUnit, 'kg') * 100) / 100;
      if (kg > MAX_LOAD_LIMIT_KG) return { kg: null, invalid: true };
      return { kg, invalid: false };
    },
    [convertWeight, weightUnit]
  );

  const dumbbellMax = parseDumbbellMax(editor?.dumbbellMaxInput ?? '');

  const trimmedName = editor?.name.trim() ?? '';
  const canSave = trimmedName.length > 0 && !dumbbellMax.invalid && !isSaving;

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (name.length === 0) return;
    const { kg: dumbbellMaxKg, invalid } = parseDumbbellMax(
      editor.dumbbellMaxInput
    );
    if (invalid) return;
    // The web edits only the dumbbell ceiling, but load_limits replaces the
    // whole column — carry the row's other entries (and any increment
    // override on the dumbbell entry itself) through untouched.
    const existingLimits = editor.profile?.load_limits ?? null;
    const nextLimits: GymLoadLimits = { ...(existingLimits ?? {}) };
    if (dumbbellMaxKg === null) {
      delete nextLimits.dumbbell;
    } else {
      nextLimits.dumbbell = {
        ...existingLimits?.dumbbell,
        max_kg: dumbbellMaxKg,
      };
    }
    const loadLimits = Object.keys(nextLimits).length > 0 ? nextLimits : null;
    const apparatus = editor.apparatusSpecified ? editor.apparatus : null;
    try {
      if (editor.profile) {
        await updateProfile({
          id: editor.profile.id,
          payload: {
            name,
            equipment: editor.equipment,
            apparatus,
            load_limits: loadLimits,
          },
        });
        // Activation is its own server-side transaction (it clears the previous
        // active row), so a profile switched on while editing needs a second
        // call.
        if (editor.makeActive && !editor.profile.is_active) {
          await activateProfile(editor.profile.id);
        }
      } else {
        await createProfile({
          name,
          equipment: editor.equipment,
          // The create schema takes optionals, not nulls: omitted already
          // means "never stated" / "no limits" on a fresh row.
          ...(apparatus !== null ? { apparatus } : {}),
          ...(loadLimits !== null ? { load_limits: loadLimits } : {}),
          is_active: editor.makeActive,
        });
      }
      setEditor(null);
    } catch {
      // apiCall and the mutation meta already surface the failure; keep the
      // dialog open so the entered values are not lost.
    }
  }, [editor, parseDumbbellMax, updateProfile, activateProfile, createProfile]);

  const handleActivate = useCallback(
    async (profile: GymProfile) => {
      if (profile.is_active || isActivating) return;
      try {
        await activateProfile(profile.id);
      } catch {
        // Toasted by the mutation meta.
      }
    },
    [activateProfile, isActivating]
  );

  const handleDeleteConfirmed = useCallback(async () => {
    if (!profilePendingDeletion) return;
    try {
      await deleteProfile(profilePendingDeletion.id);
      // Only on success: a failed delete leaves the editor open with the
      // entered values intact, the same way a failed save does.
      setEditor(null);
    } catch {
      // Toasted by the mutation meta.
    } finally {
      setProfilePendingDeletion(null);
    }
  }, [deleteProfile, profilePendingDeletion]);

  const equipmentSummary = useCallback(
    (equipment: string[]): string =>
      equipment.length === 0
        ? t('gymProfilesManager.noEquipment', 'No equipment selected')
        : equipment.map(titleCaseCanonical).join(', '),
    [t]
  );

  const editorTitle = useMemo(() => {
    if (!editor) return '';
    return editor.profile
      ? t('gymProfilesManager.editTitle', 'Edit Gym Profile')
      : t('gymProfilesManager.createTitle', 'New Gym Profile');
  }, [editor, t]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">
            {t('gymProfilesManager.cardTitle', 'Gym Profiles')}
          </CardTitle>
          <Button
            onClick={openCreate}
            size={isMobile ? 'icon' : 'default'}
            className="shrink-0"
            title={t('gymProfilesManager.addProfileButton', 'Add Profile')}
          >
            <Plus className={isMobile ? 'w-5 h-5' : 'h-4 w-4 mr-2'} />
            {!isMobile && (
              <span>
                {t('gymProfilesManager.addProfileButton', 'Add Profile')}
              </span>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : /* `isError` is also true when a refetch fails over cached data,
                so the error state is gated on there being no data to show. */
          isError && !data ? (
            <p className="text-center text-gray-400 py-10 italic">
              {t(
                'gymProfilesManager.loadError',
                'Failed to load gym profiles.'
              )}
            </p>
          ) : profiles.length === 0 ? (
            <p className="text-center text-gray-400 py-10 italic">
              {t(
                'gymProfilesManager.noProfilesFound',
                'No gym profiles yet. Create one for each place you train so suggested workouts only use equipment you actually have.'
              )}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t(
                  'gymProfilesManager.listDescription',
                  'Select a profile to make it active. With no active profile, every exercise is fair game.'
                )}
              </p>
              <div role="radiogroup" className="space-y-2">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={profile.is_active}
                      onClick={() => handleActivate(profile)}
                      disabled={isActivating}
                      className="flex flex-1 items-center gap-3 text-left min-w-0 disabled:opacity-60"
                    >
                      {profile.is_active ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">
                          {profile.name}
                        </span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {equipmentSummary(profile.equipment)}
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => openEdit(profile)}
                      title={t('common.edit', 'Edit')}
                      aria-label={t('gymProfilesManager.editProfileLabel', {
                        name: profile.name,
                        defaultValue: 'Edit {{name}}',
                      })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setProfilePendingDeletion(profile)}
                      title={t('common.delete', 'Delete')}
                      aria-label={t('gymProfilesManager.deleteProfileLabel', {
                        name: profile.name,
                        defaultValue: 'Delete {{name}}',
                      })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editorTitle}</DialogTitle>
            <DialogDescription>
              {t(
                'gymProfilesManager.editorDescription',
                'While this profile is active, suggested workouts only use the equipment you pick here. Bodyweight movements are always available.'
              )}
            </DialogDescription>
          </DialogHeader>

          {editor && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="gym-profile-name">
                  {t('gymProfilesManager.nameLabel', 'Name')}
                </Label>
                <Input
                  id="gym-profile-name"
                  value={editor.name}
                  maxLength={MAX_PROFILE_NAME_LENGTH}
                  placeholder={t(
                    'gymProfilesManager.namePlaceholder',
                    'Home, Planet Fitness…'
                  )}
                  onChange={(event) =>
                    setEditor((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>
                  {t('gymProfilesManager.equipmentLabel', 'Equipment')}
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {EQUIPMENT.map((value) => {
                    const checkboxId = `gym-profile-equipment-${value.replace(/\s+/g, '-')}`;
                    return (
                      <div key={value} className="flex items-center gap-2">
                        <Checkbox
                          id={checkboxId}
                          checked={editor.equipment.includes(value)}
                          onCheckedChange={() => toggleEquipment(value)}
                        />
                        <Label
                          htmlFor={checkboxId}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {titleCaseCanonical(value)}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>
                    {t('gymProfilesManager.apparatusLabel', 'Apparatus')}
                  </Label>
                  {editor.apparatusSpecified ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditor((current) =>
                          current
                            ? {
                                ...current,
                                apparatusSpecified: false,
                                apparatus: [],
                              }
                            : current
                        )
                      }
                    >
                      {t(
                        'gymProfilesManager.apparatusClearButton',
                        'Let Sparky assume'
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEditor((current) =>
                          current
                            ? { ...current, apparatusSpecified: true }
                            : current
                        )
                      }
                    >
                      {t(
                        'gymProfilesManager.apparatusSpecifyButton',
                        'Specify apparatus'
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'gymProfilesManager.apparatusHelper',
                    "What's physically at this gym — pull-up bars, racks, benches. Left unspecified, Sparky assumes from your equipment."
                  )}
                </p>
                {editor.apparatusSpecified && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {EXERCISE_APPARATUS.map((value) => {
                      const checkboxId = `gym-profile-apparatus-${value.replace(/\s+/g, '-')}`;
                      return (
                        <div key={value} className="flex items-center gap-2">
                          <Checkbox
                            id={checkboxId}
                            checked={editor.apparatus.includes(value)}
                            onCheckedChange={() => toggleApparatus(value)}
                          />
                          <Label
                            htmlFor={checkboxId}
                            className="text-sm font-normal cursor-pointer"
                          >
                            {titleCaseCanonical(value)}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="gym-profile-dumbbell-max">
                  {t('gymProfilesManager.dumbbellMaxLabel', {
                    unit: weightUnit,
                    defaultValue: 'Heaviest dumbbell ({{unit}})',
                  })}
                </Label>
                <Input
                  id="gym-profile-dumbbell-max"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={editor.dumbbellMaxInput}
                  placeholder={t(
                    'gymProfilesManager.dumbbellMaxPlaceholder',
                    'No limit'
                  )}
                  onChange={(event) =>
                    setEditor((current) =>
                      current
                        ? { ...current, dumbbellMaxInput: event.target.value }
                        : current
                    )
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {t(
                    'gymProfilesManager.dumbbellMaxHelper',
                    'Per hand. Suggested workouts never prescribe a heavier dumbbell. Leave empty for no limit.'
                  )}
                </p>
                {dumbbellMax.invalid && (
                  <p className="text-sm text-destructive">
                    {t(
                      'gymProfilesManager.dumbbellMaxInvalid',
                      'Enter a weight above zero, or leave it empty.'
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-3">
                  <p className="font-medium">
                    {t(
                      'gymProfilesManager.useProfileTitle',
                      'Use this profile'
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      'gymProfilesManager.useProfileDescription',
                      'Makes it the active profile for workout suggestions.'
                    )}
                  </p>
                </div>
                <Switch
                  checked={editor.makeActive}
                  // Turning the active profile off has no meaning — activate a
                  // different one instead.
                  disabled={editor.profile?.is_active === true}
                  onCheckedChange={(makeActive) =>
                    setEditor((current) =>
                      current ? { ...current, makeActive } : current
                    )
                  }
                  aria-label={t(
                    'gymProfilesManager.useProfileTitle',
                    'Use this profile'
                  )}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {editor?.profile && (
              <Button
                variant="destructive"
                className="sm:mr-auto"
                onClick={() => setProfilePendingDeletion(editor.profile)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('common.delete', 'Delete')}
              </Button>
            )}
            <Button variant="outline" onClick={closeEditor} disabled={isSaving}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {profilePendingDeletion && (
        <ConfirmationDialog
          open={profilePendingDeletion !== null}
          onOpenChange={(open) => {
            if (!open) setProfilePendingDeletion(null);
          }}
          onConfirm={handleDeleteConfirmed}
          variant="destructive"
          title={t('gymProfilesManager.deleteTitle', 'Delete gym profile')}
          description={t('gymProfilesManager.deleteDescription', {
            name: profilePendingDeletion.name,
            defaultValue:
              'Delete "{{name}}"? Workouts you have already logged are not affected.',
          })}
        />
      )}
    </div>
  );
};

export default GymProfilesManager;
