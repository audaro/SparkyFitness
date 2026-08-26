import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Accordion, AccordionItem } from '@/components/ui/accordion';

const preferences = {
  medicationCatalogLookupEnabled: false,
  setMedicationCatalogLookupEnabled: jest.fn(),
  saveAllPreferences: jest.fn(),
};

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => preferences,
}));

const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

import MedicationSettings from '@/pages/Settings/MedicationSettings';

/**
 * The switch that governs whether a medication name may leave the user's server. Two things are
 * worth a test: that turning it on is actually persisted, and that a failed save leaves the
 * switch telling the truth about what the server recorded.
 */

const renderSettings = () =>
  render(
    <Accordion type="multiple" defaultValue={['medication-settings']}>
      <AccordionItem value="medication-settings">
        <MedicationSettings />
      </AccordionItem>
    </Accordion>
  );

beforeEach(() => {
  preferences.medicationCatalogLookupEnabled = false;
  preferences.setMedicationCatalogLookupEnabled = jest.fn();
  preferences.saveAllPreferences = jest.fn().mockResolvedValue(undefined);
  mockToast.mockReset();
});

describe('MedicationSettings', () => {
  it('starts off, and says what turning it on sends', () => {
    renderSettings();
    expect(screen.getByRole('switch')).not.toBeChecked();
    // Consent without knowing what is sent is not consent, so the row names the recipient.
    expect(
      screen.getByText(/National Library of Medicine/)
    ).toBeInTheDocument();
    // This one preference now covers two recipients: the name search, and the label lookup that
    // asks the FDA who makes a saved medication. Reusing it is only defensible while the copy
    // names both — if a future lookup sends something this text does not describe, either the
    // text changes with it or that lookup gets its own opt-in.
    expect(
      screen.getByText(/US Food and Drug Administration/)
    ).toBeInTheDocument();
  });

  it('persists the opt-in', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('switch'));

    expect(preferences.setMedicationCatalogLookupEnabled).toHaveBeenCalledWith(
      true
    );
    await waitFor(() =>
      expect(preferences.saveAllPreferences).toHaveBeenCalledWith({
        medicationCatalogLookupEnabled: true,
      })
    );
  });

  it('puts the switch back when the save fails', async () => {
    preferences.saveAllPreferences = jest
      .fn()
      .mockRejectedValue(new Error('server down'));
    renderSettings();
    fireEvent.click(screen.getByRole('switch'));

    // The failure that matters: a switch left reading "on" over a server that never recorded it
    // would have the user believe lookups were enabled when nothing would happen — or, turning
    // it off, believe they had stopped when they had not.
    await waitFor(() =>
      expect(
        preferences.setMedicationCatalogLookupEnabled
      ).toHaveBeenLastCalledWith(false)
    );
    expect(mockToast).toHaveBeenCalled();
  });
});
