import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pill } from 'lucide-react';
import { AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { usePreferences } from '@/contexts/PreferencesContext';
import { toast } from '@/hooks/use-toast';

/**
 * Medication settings. One switch today: whether medication names may be looked up against the
 * US drug catalog.
 *
 * The copy below is longer than a settings row usually gets, deliberately. This is consent for
 * sending a medication name to a third party, and consent given without knowing what is sent is
 * not consent — so the row says what leaves, where it goes, and what does not leave with it.
 */
export default function MedicationSettings() {
  const { t } = useTranslation();
  const {
    medicationCatalogLookupEnabled,
    setMedicationCatalogLookupEnabled,
    saveAllPreferences,
  } = usePreferences();
  const [saving, setSaving] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    // Optimistic, then reverted on failure. A switch that reports a state the server did not
    // record would be the worst kind of wrong here: the user would believe lookups were off.
    setMedicationCatalogLookupEnabled(enabled);
    setSaving(true);
    try {
      await saveAllPreferences({ medicationCatalogLookupEnabled: enabled });
    } catch {
      setMedicationCatalogLookupEnabled(!enabled);
      toast({
        title: t('common.error', 'Error'),
        description: t(
          'settings.medications.saveFailed',
          'That setting could not be saved. It is unchanged.'
        ),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AccordionTrigger
        className="flex items-center gap-2 p-4 hover:no-underline"
        description={t(
          'settings.medications.description',
          'Drug name lookups for the medication cabinet'
        )}
      >
        <Pill className="h-5 w-5 text-primary" />
        {t('settings.medications.title', 'Medications')}
      </AccordionTrigger>
      <AccordionContent className="p-4 pt-0 space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label
              htmlFor="medication_catalog_lookup_enabled"
              className="text-sm font-medium"
            >
              {t(
                'settings.medications.catalogLookupLabel',
                'Search the US drug catalog'
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t(
                'settings.medications.catalogLookupDescription',
                'Adds around 20,000 US prescription products to the suggestions when you type a medication name, with their strengths and forms, and shows who makes a medication you saved from it. Off by default.'
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                'settings.medications.catalogLookupPrivacy',
                'What this sends: the name you are typing, from this server to the US National Library of Medicine. For a medication you saved from that catalog, this server also asks the US Food and Drug Administration who makes it, sending only a public numeric drug code — never your name for it. Your account, your medication list and everything else about you stay here. Your own medications and the built-in drug list are searched offline either way.'
              )}
            </p>
          </div>
          <Switch
            id="medication_catalog_lookup_enabled"
            checked={medicationCatalogLookupEnabled}
            disabled={saving}
            onCheckedChange={handleToggle}
          />
        </div>
      </AccordionContent>
    </>
  );
}
