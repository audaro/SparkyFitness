import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import ReconstitutionCalculator from '@/pages/Medications/ReconstitutionCalculator';

// A `t` that interpolates the way i18next does, and deliberately leaves an unmatched
// `{{placeholder}}` in place. `reconstitute()` lives in `shared`, which has no translator, so
// the whole point of the wiring under test is that the UI rebuilds each sentence from the
// result's `reason` / `code` plus its `details` — a surviving placeholder means `details` did
// not carry a value the sentence names, which is exactly what a Polish user would see raw.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValue: string,
      params?: Record<string, string | number>
    ) =>
      defaultValue.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
        params && Object.hasOwn(params, name) ? String(params[name]) : whole
      ),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

function fill(vial: string, diluent: string, dose: string) {
  fireEvent.change(screen.getByLabelText('Vial contains'), {
    target: { value: vial },
  });
  fireEvent.change(screen.getByLabelText('Diluent (mL)'), {
    target: { value: diluent },
  });
  fireEvent.change(screen.getByLabelText('Your dose'), {
    target: { value: dose },
  });
}

describe('ReconstitutionCalculator — translated refusals and cautions', () => {
  it('renders a refusal through i18n with its details filled in', () => {
    render(<ReconstitutionCalculator />);
    fill('10', '2', '20');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'A 20 mg dose is more than the vial holds (10 mg).'
    );
    expect(alert.textContent).not.toContain('{{');
  });

  it('renders a caution through i18n quoting the same number as the result', () => {
    render(<ReconstitutionCalculator />);
    fill('10', '1', '0.1');

    // 10 mg/mL, 0.1 mg dose -> 0.01 mL -> 1 unit, below what a barrel measures.
    expect(screen.getByTestId('recon-units')).toHaveTextContent(/^1 units/);
    const caution = screen.getByText(/below what a syringe barrel measures/);
    expect(caution).toHaveTextContent(
      '1 units is below what a syringe barrel measures reliably.'
    );
    expect(caution.textContent).not.toContain('{{');
  });

  it('never falls back to the untranslated message from shared', () => {
    render(<ReconstitutionCalculator />);
    fill('10', '2', '0');

    // An unfilled dose is not a refusal — blank is "not typed yet" — but a zero is.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter your dose as a number greater than zero.'
    );
  });
});
