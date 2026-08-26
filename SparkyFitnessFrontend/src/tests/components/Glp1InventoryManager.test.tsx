import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Glp1InventoryManager from '@/pages/Medications/Glp1InventoryManager';
import type { Medication, MedicationPen } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? '',
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

// The card reads the user's timezone to decide whether an expiry or BUD date has passed.
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'UTC' }),
}));

const mockCreateMutate = jest.fn(
  (_body: unknown, options?: { onSuccess?: () => void }) =>
    options?.onSuccess?.()
);
const mockUpdateMutate = jest.fn(
  (_args: unknown, options?: { onSuccess?: () => void }) =>
    options?.onSuccess?.()
);
const mockDeleteMutate = jest.fn();
let mockPens: MedicationPen[] = [];

// react-query backed; this suite renders the component without a QueryClientProvider.
jest.mock('@/hooks/useMedications', () => ({
  useMedicationPens: () => ({ data: mockPens }),
  useCreatePenMutation: () => ({ mutate: mockCreateMutate, isPending: false }),
  useUpdatePenMutation: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useDeletePenMutation: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Radix's Select needs a real pointer stack to open. Swapped for buttons so the kind
// switch — which is what applies the vial prefill — can be driven directly.
jest.mock('@/components/ui/select', () => {
  const SelectContext = React.createContext<(value: string) => void>(() => {});

  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <SelectContext.Provider value={onValueChange ?? (() => {})}>
        {children}
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectItem: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const onValueChange = React.useContext(SelectContext);
      return (
        <button
          type="button"
          data-value={value}
          onClick={() => onValueChange(value)}
        >
          {children}
        </button>
      );
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectValue: () => <span />,
  };
});

function medication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    user_id: 'user-1',
    name: 'Retatrutide',
    display_name: null,
    type_id: null,
    route_id: null,
    strength_value: null,
    strength_unit: null,
    dose_amount: null,
    dose_unit: null,
    reason_text: null,
    effectiveness_rating: null,
    color: null,
    icon: null,
    photo_path: null,
    is_active: true,
    is_quick: false,
    is_glp1: true,
    is_supplement: false,
    nutrients: {},
    notes: null,
    source: 'manual',
    custom_fields: {},
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A medication carrying the mix the calculator saved: a 10 mg vial in 2 mL, dosed at 2 mg. */
function reconstitutedMedication(
  overrides: {
    vial_amount?: number;
    vial_unit?: 'mg' | 'mcg' | 'iu';
    diluent_ml?: number;
    dose_amount?: number | null;
    dose_unit?: string | null;
  } = {}
): Medication {
  const {
    vial_amount = 10,
    vial_unit = 'mg',
    diluent_ml = 2,
    dose_amount = 2,
    dose_unit = 'mg',
  } = overrides;

  return medication({
    dose_amount,
    dose_unit,
    custom_fields: {
      reconstitution: {
        vial_amount,
        vial_unit,
        diluent_ml,
        syringe: 'U-100',
      },
    },
  });
}

function pen(overrides: Partial<MedicationPen> = {}): MedicationPen {
  return {
    id: 'pen-1',
    medication_id: 'med-1',
    kind: 'pen',
    label: null,
    dose_mg: null,
    concentration_mg_ml: null,
    volume_ml: null,
    doses_total: 4,
    doses_used: 0,
    status: 'sealed',
    opened_at: null,
    expiry_date: null,
    bud_date: null,
    reorder_flag: false,
    reorder_threshold: null,
    notes: null,
    ...overrides,
  };
}

/**
 * The card header and the dialog footer both hold a button reading "Add Inventory".
 * Opening happens while the dialog is closed, so the header one is unambiguous there;
 * saving always targets the last match, which is the footer.
 */
function openAddDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
}

function clickSave() {
  const buttons = screen.getAllByRole('button', { name: 'Add Inventory' });
  const save = buttons.at(-1);
  if (!save) throw new Error('no Add Inventory button to save with');
  fireEvent.click(save);
}

/** The body the add mutation was called with, or a failure naming what went wrong. */
function createdBody(): Partial<MedicationPen> {
  const call = mockCreateMutate.mock.calls[0];
  if (!call) throw new Error('the add mutation was never called');
  return call[0] as Partial<MedicationPen>;
}

function updatedArgs(): { id: string; body: Partial<MedicationPen> } {
  const call = mockUpdateMutate.mock.calls[0];
  if (!call) throw new Error('the update mutation was never called');
  return call[0] as { id: string; body: Partial<MedicationPen> };
}

const value = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;

beforeEach(() => {
  jest.clearAllMocks();
  mockPens = [];
});

describe('Glp1InventoryManager inventory list', () => {
  it('says so when nothing is tracked', () => {
    render(<Glp1InventoryManager med={medication()} />);

    expect(screen.getByText('No pens/vials tracked.')).toBeInTheDocument();
  });

  it('counts down the doses left rather than the doses used', () => {
    mockPens = [pen({ doses_total: 4, doses_used: 3 })];
    render(<Glp1InventoryManager med={medication()} />);

    expect(screen.getByText('doses').parentElement?.textContent).toBe(
      '1/4 doses'
    );
  });

  it('shows a reorder badge only once the remaining doses reach the threshold', () => {
    mockPens = [
      pen({
        doses_total: 4,
        doses_used: 2,
        reorder_flag: true,
        reorder_threshold: 1,
      }),
    ];
    const { rerender } = render(<Glp1InventoryManager med={medication()} />);

    expect(screen.queryByText('Reorder')).not.toBeInTheDocument();

    mockPens = [
      pen({
        doses_total: 4,
        doses_used: 3,
        reorder_flag: true,
        reorder_threshold: 1,
      }),
    ];
    rerender(<Glp1InventoryManager med={medication()} />);

    expect(screen.getByText('Reorder')).toBeInTheDocument();
  });

  it('removes a pen through the delete mutation', () => {
    mockPens = [pen({ id: 'pen-7' })];
    render(<Glp1InventoryManager med={medication()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove pen/vial' }));

    expect(mockDeleteMutate).toHaveBeenCalledWith('pen-7');
  });
});

describe('Glp1InventoryManager vial prefill', () => {
  it('opens on the vial fields, filled from the mix, when one is on record', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();

    // 10 mg in 2 mL is 5 mg/mL, and a 2 mg dose takes five of them out of the vial.
    expect(value('Concentration (mg/mL)')).toBe('5');
    expect(value('Volume (mL)')).toBe('2');
    expect(value('Total Doses')).toBe('5');
  });

  it('opens on a pen with the old constants when no mix is on record', () => {
    render(<Glp1InventoryManager med={medication({ dose_amount: 2.5 })} />);
    openAddDialog();

    // The vial-only fields are not rendered at all while the kind is pen.
    expect(screen.queryByLabelText('Concentration (mg/mL)')).toBeNull();
    expect(screen.queryByLabelText('Volume (mL)')).toBeNull();
    expect(value('Total Doses')).toBe('4');
  });

  it('treats a half-written reconstitution record as no record at all', () => {
    const med = medication({
      dose_amount: 2,
      dose_unit: 'mg',
      // No diluent_ml: the mix is unfinished, so there is nothing to derive from.
      custom_fields: {
        reconstitution: { vial_amount: 10, vial_unit: 'mg', syringe: 'U-100' },
      },
    });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    expect(screen.queryByLabelText('Concentration (mg/mL)')).toBeNull();
    expect(value('Total Doses')).toBe('4');
  });

  it('converts a mcg vial into the mg/mL the column is measured in', () => {
    const med = reconstitutedMedication({
      vial_amount: 5000,
      vial_unit: 'mcg',
      diluent_ml: 2,
      dose_amount: 500,
      dose_unit: 'mcg',
    });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    // 2500 mcg/mL is 2.5 mg/mL. Writing 2500 into a mg/mL column is the dangerous bug.
    expect(value('Concentration (mg/mL)')).toBe('2.5');
    expect(value('Total Doses')).toBe('10');
  });

  it('leaves an IU vial without a concentration but still fills what it knows', () => {
    const med = reconstitutedMedication({
      vial_amount: 5000,
      vial_unit: 'iu',
      diluent_ml: 2,
      dose_amount: 500,
      dose_unit: 'iu',
    });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    // There is no factor from IU to mass, and the column is mg/mL. Blank is the answer.
    expect(value('Concentration (mg/mL)')).toBe('');
    expect(value('Volume (mL)')).toBe('2');
    expect(value('Total Doses')).toBe('10');
  });

  it('fills the bottle facts when the dose is unknown', () => {
    const med = reconstitutedMedication({ dose_amount: null, dose_unit: null });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    // Concentration and volume are facts about the bottle and hold without a dose.
    expect(value('Concentration (mg/mL)')).toBe('5');
    expect(value('Volume (mL)')).toBe('2');
  });

  it('reads a hand-typed dose unit case-insensitively', () => {
    const med = reconstitutedMedication({ dose_unit: ' MG ' });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    expect(value('Total Doses')).toBe('5');
  });

  it('leaves the dose count empty when the dose does not divide the vial', () => {
    // A 2 mg vial cannot yield a single 5 mg dose, so `reconstitute` refuses. On a vial
    // whose mix we have actually measured, the constant would read as a derived number.
    const med = reconstitutedMedication({
      vial_amount: 2,
      diluent_ml: 1,
      dose_amount: 5,
    });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    expect(value('Total Doses')).toBe('');
  });

  it('refuses a dose count for a dose the vial does not share a unit family with', () => {
    const med = reconstitutedMedication({
      vial_amount: 5000,
      vial_unit: 'iu',
      dose_amount: 2,
      dose_unit: 'mg',
    });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();

    expect(value('Total Doses')).toBe('');
  });

  it('saves a refused dose count as null rather than a guess', () => {
    const med = reconstitutedMedication({
      vial_amount: 2,
      diluent_ml: 1,
      dose_amount: 5,
    });
    render(<Glp1InventoryManager med={med} />);
    openAddDialog();
    clickSave();

    expect(createdBody()).toMatchObject({ doses_total: null });
  });
});

describe('Glp1InventoryManager kind switching', () => {
  it('applies the prefill when the user switches a pen to a vial', () => {
    // Switching away and back is the path a user takes after opening the form on the
    // wrong kind, so the prefill has to live on the switch and not only on open.
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));

    expect(value('Total Doses')).toBe('4');
    expect(screen.queryByLabelText('Concentration (mg/mL)')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Vial' }));

    expect(value('Concentration (mg/mL)')).toBe('5');
    expect(value('Volume (mL)')).toBe('2');
    expect(value('Total Doses')).toBe('5');
  });

  it('returns to the pen default when switched back', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();

    expect(value('Total Doses')).toBe('5');

    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));

    expect(value('Total Doses')).toBe('4');
  });

  it('switches a medication with no mix to a vial on the old constants', () => {
    render(<Glp1InventoryManager med={medication()} />);
    openAddDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Vial' }));

    expect(value('Concentration (mg/mL)')).toBe('');
    expect(value('Volume (mL)')).toBe('');
    expect(value('Total Doses')).toBe('10');
  });
});

describe('Glp1InventoryManager saving', () => {
  it('saves the derived vial numbers without the user retyping them', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    clickSave();

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(createdBody()).toMatchObject({
      kind: 'vial',
      concentration_mg_ml: 5,
      volume_ml: 2,
      doses_total: 5,
      dose_mg: 2,
      status: 'sealed',
    });
  });

  it('drops the vial-only fields when the kind is a pen', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    clickSave();

    expect(createdBody()).toMatchObject({
      kind: 'pen',
      concentration_mg_ml: null,
      volume_ml: null,
      doses_total: 4,
    });
  });

  it('marks a vial in use when it is added with an opened date', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-01' },
    });
    clickSave();

    expect(createdBody()).toMatchObject({
      status: 'in_use',
      opened_at: '2026-08-01',
    });
  });

  it('suggests a beyond-use date 28 days from opening', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-01' },
    });

    // 28 days is the bacteriostatic-water window. Asserted so that changing it has to
    // be a deliberate act rather than a drive-by edit.
    expect(value('Beyond-Use Date (BUD)')).toBe('2026-08-29');

    clickSave();

    expect(createdBody()).toMatchObject({ bud_date: '2026-08-29' });
  });

  it('says which diluent the suggested window assumes', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-01' },
    });

    // The number is only right for one diluent, so the form has to say which.
    expect(screen.getByText(/bacteriostatic water/i).textContent).toMatch(
      /sterile preservative-free water is far shorter/i
    );
  });

  it('keeps a hand-typed BUD when the opened date moves', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-01' },
    });
    // A shorter window, deliberately chosen — sterile water rather than bacteriostatic.
    fireEvent.change(screen.getByLabelText('Beyond-Use Date (BUD)'), {
      target: { value: '2026-08-02' },
    });
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-03' },
    });

    expect(value('Beyond-Use Date (BUD)')).toBe('2026-08-02');

    clickSave();

    expect(createdBody()).toMatchObject({ bud_date: '2026-08-02' });
  });

  it('offers no beyond-use date at all until the vial is opened', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();

    expect(screen.queryByLabelText('Beyond-Use Date (BUD)')).toBeNull();

    clickSave();

    expect(createdBody()).toMatchObject({ bud_date: null });
  });

  it('sends no reorder threshold while the warning is off', () => {
    render(<Glp1InventoryManager med={medication()} />);
    openAddDialog();
    clickSave();

    expect(createdBody()).toMatchObject({
      reorder_flag: false,
      reorder_threshold: null,
    });
  });

  it('reopens on the prefill after a save', () => {
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText('Total Doses'), {
      target: { value: '3' },
    });
    clickSave();
    openAddDialog();

    // resetForm runs on the success path, so the edited value must not survive it.
    expect(value('Total Doses')).toBe('5');
  });
});

describe('Glp1InventoryManager editing an existing row', () => {
  it('shows the stored row rather than the medication prefill', () => {
    mockPens = [
      pen({
        id: 'pen-3',
        kind: 'vial',
        concentration_mg_ml: 3,
        volume_ml: 4,
        doses_total: 8,
        dose_mg: 1.5,
      }),
    ];
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));

    // The mix says 5 mg/mL in 2 mL for five doses; a saved row outranks all of it.
    expect(value('Concentration (mg/mL)')).toBe('3');
    expect(value('Volume (mL)')).toBe('4');
    expect(value('Total Doses')).toBe('8');
    expect(value('Dose Strength (mg)')).toBe('1.5');
  });

  it('updates rather than creates, and leaves a finished vial finished', () => {
    mockPens = [pen({ id: 'pen-3', kind: 'vial', status: 'finished' })];
    render(<Glp1InventoryManager med={reconstitutedMedication()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    const args = updatedArgs();
    expect(args.id).toBe('pen-3');
    expect(args.body.status).toBeUndefined();
  });

  it('never recomputes a BUD the saved row already carries', () => {
    mockPens = [
      pen({ id: 'pen-3', opened_at: '2026-08-01', bud_date: '2026-08-05' }),
    ];
    render(<Glp1InventoryManager med={medication()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-02' },
    });

    // 2026-08-05 is someone's deliberate short window; moving the opened date must not
    // quietly replace it with the generous default.
    expect(value('Beyond-Use Date (BUD)')).toBe('2026-08-05');
  });

  it('suggests a BUD for a saved row that never had one', () => {
    mockPens = [pen({ id: 'pen-3', opened_at: null, bud_date: null })];
    render(<Glp1InventoryManager med={medication()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-01' },
    });

    expect(value('Beyond-Use Date (BUD)')).toBe('2026-08-29');
  });

  it('moves a sealed row into use once an opened date is set', () => {
    mockPens = [pen({ id: 'pen-3', status: 'sealed' })];
    render(<Glp1InventoryManager med={medication()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit pen/vial' }));
    fireEvent.change(screen.getByLabelText('Date Opened'), {
      target: { value: '2026-08-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(updatedArgs().body.status).toBe('in_use');
  });
});
