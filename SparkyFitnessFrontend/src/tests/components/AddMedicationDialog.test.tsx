import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import AddMedicationDialog from '@/pages/Medications/AddMedicationDialog';
import type { Medication } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolates like i18next so assertions can read the rendered sentence rather
    // than a template. An unmatched {{placeholder}} is left in place deliberately —
    // that is what a missing param looks like on screen.
    t: (
      _key: string,
      defaultValue?: string,
      params?: Record<string, unknown>
    ) =>
      (defaultValue ?? '').replace(/\{\{(\w+)\}\}/g, (match, name) =>
        params && name in params ? String(params[name]) : match
      ),
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

const mockCreateMutate = jest.fn(
  (_body: unknown, options?: { onSuccess?: () => void }) =>
    options?.onSuccess?.()
);
const mockUpdateMutate = jest.fn(
  (_args: unknown, options?: { onSuccess?: () => void }) =>
    options?.onSuccess?.()
);
let mockOwnMedications: Medication[] = [];
// The nutrition editor's catalog hooks are react-query backed; this suite renders the
// dialog without a QueryClientProvider.
jest.mock('@/hooks/Foods/useCustomNutrients', () => ({
  useCustomNutrients: () => ({ data: [] }),
  useCreateCustomNutrientMutation: () => ({ mutateAsync: jest.fn() }),
  useEnsureCatalogNutrientsMutation: () => ({ mutateAsync: jest.fn() }),
}));

// The nutrition editor reads the energy unit from preferences; this suite renders the
// dialog bare, without the provider.
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    timezone: 'UTC',
    timeFormat: 'h:mm A',
    firstDayOfWeek: 0,
  }),
}));

// better-auth ships an untransformed ESM build that jest does not process, and it is
// reachable from this component through the auth hook. Cutting the chain at the hook
// covers every import path that reaches it.
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isLoading: false }),
}));

// The dialog gates its nutrition editor on the active profile's diary permission.
// ActiveUserContext reaches useAuth and so pulls better-auth's ESM build into this
// suite's module graph, which jest does not transform; mock the hook rather than
// widen transformIgnorePatterns for one context.
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    hasWritePermission: () => true,
    hasPermission: () => true,
    activeUserId: 'user-1',
    activeUserName: 'Test User',
    isActingOnBehalf: false,
  }),
}));

jest.mock('@/hooks/useMedications', () => ({
  useCreateMedicationMutation: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
  useUpdateMedicationMutation: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
  // Tier 1 of the name combobox. Empty by default so these tests exercise the catalog and
  // custom rows without a cabinet in the way; the suite below overrides it where it matters.
  useMedications: () => ({ data: mockOwnMedications, isError: false }),
}));

const mirroredMed = {
  id: 'med-1',
  name: 'Metformin',
  type_id: 'pill',
  is_glp1: false,
  strength_value: 500,
  strength_unit: 'mg',
  dose_amount: 500,
  dose_unit: 'mg',
  custom_fields: {},
} as unknown as Medication;

const mobileDoseMed = {
  ...mirroredMed,
  id: 'med-2',
  dose_amount: 1,
  dose_unit: 'tablet',
} as unknown as Medication;

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Add medication/ }));
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function lastCreateBody(): Partial<Medication> {
  const call = mockCreateMutate.mock.calls.at(-1);
  if (!call) throw new Error('createMutation.mutate was not called');
  return call[0] as Partial<Medication>;
}

function lastUpdateArgs(): { id: string; body: Partial<Medication> } {
  const call = mockUpdateMutate.mock.calls.at(-1);
  if (!call) throw new Error('updateMutation.mutate was not called');
  return call[0] as { id: string; body: Partial<Medication> };
}

describe('AddMedicationDialog dose fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnMedications = [];
  });

  it('mirrors strength into the dose when untouched (add)', () => {
    render(<AddMedicationDialog />);
    openDialog();
    setField('Name', 'Metformin');
    setField('Strength', '500');
    save();

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(lastCreateBody()).toMatchObject({
      strength_value: 500,
      strength_unit: 'mg',
      dose_amount: 500,
      dose_unit: 'mg',
    });
  });

  it('sends an edited dose verbatim alongside the strength (add)', () => {
    render(<AddMedicationDialog />);
    openDialog();
    setField('Name', 'Metformin');
    setField('Strength', '500');
    setField('Dose', '2');
    setField('Dose unit', 'tablet');
    save();

    expect(lastCreateBody()).toMatchObject({
      strength_value: 500,
      strength_unit: 'mg',
      dose_amount: 2,
      dose_unit: 'tablet',
    });
  });

  it('cross-seeds the unit from the mirrored value on first touch of the amount', () => {
    render(<AddMedicationDialog />);
    openDialog();
    setField('Name', 'Metformin');
    setField('Strength', '500');
    setField('Dose', '2');

    expect(screen.getByLabelText('Dose unit')).toHaveValue('mg');

    save();
    expect(lastCreateBody()).toMatchObject({
      dose_amount: 2,
      dose_unit: 'mg',
    });
  });

  it('cross-seeds the amount from the mirrored value on first touch of the unit', () => {
    render(<AddMedicationDialog />);
    openDialog();
    setField('Name', 'Metformin');
    setField('Strength', '500');
    setField('Dose unit', 'tablet');

    expect(screen.getByLabelText('Dose')).toHaveValue(500);

    save();
    expect(lastCreateBody()).toMatchObject({
      dose_amount: 500,
      dose_unit: 'tablet',
    });
  });

  it('preserves a distinct (mobile-set) dose when only the name changes (edit)', () => {
    render(<AddMedicationDialog editMed={mobileDoseMed} />);
    openDialog();
    setField('Name', 'Metformin XR');
    save();

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    const { id, body } = lastUpdateArgs();
    expect(id).toBe('med-2');
    expect(body).toMatchObject({
      name: 'Metformin XR',
      strength_value: 500,
      strength_unit: 'mg',
      dose_amount: 1,
      dose_unit: 'tablet',
    });
  });

  it('keeps a mirrored dose following a strength change (edit)', () => {
    render(<AddMedicationDialog editMed={mirroredMed} />);
    openDialog();
    setField('Strength', '1000');
    save();

    const { body } = lastUpdateArgs();
    expect(body).toMatchObject({
      strength_value: 1000,
      dose_amount: 1000,
      dose_unit: 'mg',
    });
  });

  it('sends a cleared dose amount as null while keeping the unit (edit)', () => {
    render(<AddMedicationDialog editMed={mobileDoseMed} />);
    openDialog();
    setField('Dose', '');
    save();

    const { body } = lastUpdateArgs();
    expect(body).toMatchObject({
      dose_amount: null,
      dose_unit: 'tablet',
    });
  });

  it('does not invent a mirror for a dose-null row with strength (edit)', () => {
    const doseNullMed = {
      ...mirroredMed,
      id: 'med-3',
      dose_amount: null,
      dose_unit: null,
    } as unknown as Medication;
    render(<AddMedicationDialog editMed={doseNullMed} />);
    openDialog();
    setField('Name', 'Metformin XR');
    save();

    const { body } = lastUpdateArgs();
    expect(body).toMatchObject({
      strength_value: 500,
      dose_amount: null,
      dose_unit: null,
    });
  });

  it('resets strength and dose fields after a successful create', () => {
    render(<AddMedicationDialog />);
    openDialog();
    setField('Name', 'Metformin');
    setField('Strength', '500');
    setField('Dose', '2');
    setField('Dose unit', 'tablet');
    save();

    openDialog();
    expect(screen.getByLabelText('Strength')).toHaveValue(null);
    expect(screen.getByLabelText('Strength unit')).toHaveValue('mg');
    expect(screen.getByLabelText('Dose')).toHaveValue(null);
    expect(screen.getByLabelText('Dose unit')).toHaveValue('mg');
  });

  // The dialog is not remounted between saves, so anything the create-success handler
  // forgets to clear is still on screen for the next supplement. The macro block is the
  // dangerous one: it renders from `includeMacros` but only *selected* keys are saved, so
  // a block left ticked with its keys dropped accepts values and silently discards them.
  it('resets the macro block and the serving size after a successful create (supplement)', async () => {
    render(<AddMedicationDialog defaultIsSupplement />);
    // The serving-size field is the one input in this block with no <Label>, and the
    // dialog is portalled out of the render container, so query the document for it.
    const servingInput = () =>
      document.querySelector<HTMLInputElement>('#units-per-serving');

    openDialog();
    setField('Name', 'Fish oil');
    // The only checkbox on the supplement form; the rest are switches.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Calories'), {
      target: { value: '15' },
    });
    fireEvent.change(servingInput()!, { target: { value: '2' } });
    save();

    // Proves the block was genuinely filled in, so the reset assertions below are not
    // passing against a form that never had the state in the first place.
    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    expect(lastCreateBody()).toMatchObject({
      nutrients: expect.objectContaining({ calories: 15 }),
      custom_fields: expect.objectContaining({ units_per_serving: 2 }),
    });

    openDialog();
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'unchecked'
    );
    expect(screen.queryByLabelText('Calories')).not.toBeInTheDocument();
    expect(servingInput()).toHaveValue(null);
  });

  // Same class as the reset above, at the other end: the block opens if ANY of the five
  // was saved, but only selected keys are saved. Seeding just the saved ones leaves the
  // other four visible and typeable, and getNutrients() then drops what is typed there.
  it('saves a macro added to a supplement that had only some of them (edit)', async () => {
    const partialMacroSupp = {
      id: 'supp-1',
      name: 'Fish oil',
      type_id: 'softgel',
      is_glp1: false,
      is_supplement: true,
      dose_amount: 1,
      dose_unit: 'dose',
      custom_fields: {},
      nutrients: { calories: 15 },
    } as unknown as Medication;

    render(<AddMedicationDialog editMed={partialMacroSupp} />);
    openDialog();
    // The block is already expanded because calories was saved.
    fireEvent.change(screen.getByLabelText('Protein'), {
      target: { value: '1.5' },
    });
    save();

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    expect(lastUpdateArgs().body).toMatchObject({
      nutrients: expect.objectContaining({ calories: 15, protein: 1.5 }),
    });
  });

  // The five macros are not offered as picker rows, so free text is the only way to name
  // one there. Left unrouted, "Energy" becomes a custom nutrient no rollup reads, and an
  // exact "Calories" selects the macro key while the block stays shut and the grid, which
  // renders only the non-macro rows, shows no field for it.
  it.each([
    ['Energy', 'an alias'],
    ['Calories', 'the canonical name'],
  ])('routes free-text %s (%s) into the macro block', async (typed) => {
    render(<AddMedicationDialog defaultIsSupplement />);
    openDialog();
    setField('Name', 'Fish oil');

    fireEvent.click(screen.getByRole('button', { name: /Add nutrient/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Ashwagandha'), {
      target: { value: typed },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // The block has to be open, or the user has no field to type the value into.
    fireEvent.change(await screen.findByLabelText('Calories'), {
      target: { value: '15' },
    });
    save();

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    const nutrients = lastCreateBody().nutrients as Record<string, unknown>;
    expect(nutrients).toMatchObject({ calories: 15 });
    // Not filed as a custom nutrient under the name that was typed.
    expect(nutrients['custom_nutrients'] ?? {}).toEqual({});
  });

  it('locks the dose unit to the strength unit for injectable GLP-1 meds', () => {
    const glp1Med = {
      ...mirroredMed,
      id: 'med-glp1',
      name: 'Wegovy',
      type_id: 'injection',
      is_glp1: true,
      strength_value: 2.4,
      strength_unit: 'mg',
      dose_amount: 2.4,
      dose_unit: 'mg',
      custom_fields: { glp1_drug: 'semaglutide' },
    } as unknown as Medication;
    render(<AddMedicationDialog editMed={glp1Med} />);
    openDialog();

    expect(screen.getByLabelText('Dose per injection')).toBeInTheDocument();
    expect(screen.getByLabelText('Dose unit')).toBeDisabled();

    setField('Dose per injection', '1.7');
    save();

    const { body } = lastUpdateArgs();
    expect(body).toMatchObject({
      dose_amount: 1.7,
      dose_unit: 'mg',
    });
  });
  describe('catalog autofill (phase 2)', () => {
    it('attaches the catalog id and route when a known drug is picked', () => {
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'Reta');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Retatrutide/ }));

      save();

      const body = lastCreateBody();
      expect(body).toMatchObject({
        name: 'Reta',
        // The alias the user typed, not a rename to the generic name.
        type_id: 'injection',
        route_id: 'subcutaneous',
        source: 'catalog',
        is_glp1: true,
      });
      expect(body.custom_fields).toMatchObject({
        catalog_id: 'retatrutide',
        glp1_drug: 'retatrutide',
      });
    });

    it('opens the calculator for a drug with no label strengths and converts a vial', () => {
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'Reta');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Retatrutide/ }));

      // Retatrutide is investigational, so there is no ladder to offer.
      expect(screen.queryByText('Label strengths')).not.toBeInTheDocument();

      setField('Vial contains', '10');
      setField('Bacteriostatic water (mL)', '2');
      setField('Your dose', '2');

      expect(screen.getByTestId('recon-units')).toHaveTextContent('40');
    });

    it('offers the brand label ladder and no calculator for a pen', () => {
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'Wegovy');
      // Anchored: the "Add \"Wegovy\" as a custom medication" row also contains the word.
      const row = screen.getByRole('option', { name: /^Wegovy/ });
      // The row names its molecule, so Wegovy and Ozempic do not read as unrelated drugs.
      expect(within(row).getByText('Semaglutide')).toBeInTheDocument();
      fireEvent.mouseDown(row);

      // Wegovy's own ladder, not Ozempic's — the two are separate entries precisely because
      // 1.7 and 2.4 mg exist on one label and not the other.
      expect(screen.getByText('Label strengths')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: '1.7 mg' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '2 mg' })
      ).not.toBeInTheDocument();
      // A pen is not reconstituted, so the vial calculator stays shut.
      expect(screen.queryByLabelText('Vial contains')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '2.4 mg' }));
      save();

      const body = lastCreateBody();
      expect(body).toMatchObject({
        name: 'Wegovy',
        strength_value: 2.4,
        strength_unit: 'mg',
        is_glp1: true,
      });
      // The brand is what was picked; the PK model still sees the molecule.
      expect(body.custom_fields).toMatchObject({
        catalog_id: 'wegovy',
        glp1_drug: 'semaglutide',
      });
    });

    it('detaches the catalog id when the name is typed over', () => {
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'Reta');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Retatrutide/ }));
      setField('Name', 'Grey vial #3');

      save();

      expect(lastCreateBody().custom_fields).toMatchObject({
        catalog_id: null,
      });
    });

    it('keeps the typed name and manual source on the custom row', () => {
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'BPC-157');
      fireEvent.mouseDown(
        screen.getByRole('option', { name: /custom medication/ })
      );

      save();

      const body = lastCreateBody();
      expect(body).toMatchObject({ name: 'BPC-157', source: 'manual' });
      expect(body.custom_fields).toMatchObject({ catalog_id: null });
    });

    it("prefills from the user's own medication when one is picked", () => {
      mockOwnMedications = [mirroredMed];
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'Metf');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Metformin/ }));

      save();

      expect(lastCreateBody()).toMatchObject({
        name: 'Metformin',
        strength_value: 500,
        strength_unit: 'mg',
        dose_amount: 500,
        dose_unit: 'mg',
      });
    });
  });

  // A concentration is not a number anyone draws. These cover the round trip that makes it
  // one: apply writes the mix down, an edit reopens on it, and the draw sits on the form.
  describe('reconstitution round trip', () => {
    const reconMix = {
      vial_amount: 30,
      vial_unit: 'mg',
      diluent_ml: 3,
      syringe: 'U-100',
    };

    const vialMed = {
      id: 'med-vial',
      name: 'Retatrutide',
      type_id: 'injection',
      is_glp1: false,
      strength_value: 10,
      strength_unit: 'mg/mL',
      dose_amount: 2,
      dose_unit: 'mg',
      custom_fields: { reconstitution: reconMix },
    } as unknown as Medication;

    function openCalculator() {
      fireEvent.click(
        screen.getByRole('button', { name: /Reconstituting a vial/ })
      );
    }

    function fillCalculator() {
      setField('Vial contains', '30');
      setField('Bacteriostatic water (mL)', '3');
      setField('Your dose', '2');
    }

    it('saves the mix alongside the concentration it produced', () => {
      render(<AddMedicationDialog />);
      openDialog();
      setField('Name', 'Grey vial #3');
      openCalculator();
      fillCalculator();
      fireEvent.click(
        screen.getByRole('button', { name: 'Use these numbers' })
      );

      save();

      const body = lastCreateBody();
      // 30 mg in 3 mL: the strength is what a millilitre holds, not what the vial holds.
      expect(body).toMatchObject({
        strength_value: 10,
        strength_unit: 'mg/mL',
        dose_amount: 2,
        dose_unit: 'mg',
      });
      // Without this the concentration is a dead end — nothing left to say which vial and
      // how much water it came from.
      expect(body.custom_fields).toMatchObject({ reconstitution: reconMix });
    });

    it('reopens the calculator on the saved mix when editing', () => {
      render(<AddMedicationDialog editMed={vialMed} />);
      openDialog();

      // No "Reconstituting a vial?" button to press: a row that has a mix opens on it.
      expect(screen.getByLabelText('Vial contains')).toHaveValue(30);
      expect(screen.getByLabelText('Bacteriostatic water (mL)')).toHaveValue(3);
      // Seeded from the medication's own dose, not from the record.
      expect(screen.getByLabelText('Your dose')).toHaveValue(2);
      // The answer is on screen without the user re-entering anything.
      expect(screen.getByTestId('recon-units')).toHaveTextContent('20');
    });

    it('shows the draw next to the strength and dose it comes from', () => {
      render(<AddMedicationDialog editMed={vialMed} />);
      openDialog();

      expect(screen.getByTestId('med-draw')).toHaveTextContent(
        'Draw 0.2 mL — 20 units on a U-100 syringe'
      );
    });

    it('follows a hand-edited strength rather than the saved mix', () => {
      render(<AddMedicationDialog editMed={vialMed} />);
      openDialog();
      // The user got a different vial and typed the new concentration in directly.
      setField('Strength', '20');

      // 2 mg at 20 mg/mL is half of what it was. A draw derived from the stored 30 mg / 3 mL
      // mix would still read 20 units and send them to twice their dose.
      expect(screen.getByTestId('med-draw')).toHaveTextContent(
        'Draw 0.1 mL — 10 units on a U-100 syringe'
      );
    });

    it('reads the saved syringe rather than assuming U-100', () => {
      const u40Med = {
        ...vialMed,
        custom_fields: {
          reconstitution: { ...reconMix, syringe: 'U-40' },
        },
      } as unknown as Medication;
      render(<AddMedicationDialog editMed={u40Med} />);
      openDialog();

      expect(screen.getByTestId('med-draw')).toHaveTextContent(
        'Draw 0.2 mL — 8 units on a U-40 syringe'
      );
    });

    // A mix describes a vial. Picking a different name is picking a different vial.
    it('drops the mix when the name is picked off the catalog', () => {
      render(<AddMedicationDialog editMed={vialMed} />);
      openDialog();
      setField('Name', 'Reta');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Retatrutide/ }));

      save();

      expect(lastUpdateArgs().body.custom_fields).toMatchObject({
        reconstitution: null,
      });
    });

    it('reseeds the open calculator when the name is picked over', () => {
      render(<AddMedicationDialog editMed={vialMed} />);
      openDialog();
      expect(screen.getByLabelText('Vial contains')).toHaveValue(30);

      // Retatrutide has no label ladder, so the calculator stays open across this pick —
      // which is exactly when a mounted component would keep the old vial on screen.
      setField('Name', 'Reta');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Retatrutide/ }));

      expect(screen.getByLabelText('Vial contains')).toHaveValue(null);
      expect(screen.getByLabelText('Bacteriostatic water (mL)')).toHaveValue(
        null
      );
    });

    it("takes the mix from the user's own row when one is copied", () => {
      const otherVialMed = {
        ...vialMed,
        id: 'med-other',
        name: 'Tirzepatide',
        strength_value: 5,
        custom_fields: {
          reconstitution: { ...reconMix, vial_amount: 10, diluent_ml: 2 },
        },
      } as unknown as Medication;
      mockOwnMedications = [otherVialMed];

      render(<AddMedicationDialog editMed={vialMed} />);
      openDialog();
      setField('Name', 'Tirz');
      fireEvent.mouseDown(screen.getByRole('option', { name: /Tirzepatide/ }));

      save();

      // The copied row's mix, not the one that was on screen a moment ago — otherwise the
      // strength comes from one medication and the vial behind it from another.
      expect(lastUpdateArgs().body.custom_fields).toMatchObject({
        reconstitution: { vial_amount: 10, diluent_ml: 2 },
      });
    });

    it('claims no draw for a strength that is not a concentration', () => {
      render(<AddMedicationDialog editMed={mirroredMed} />);
      openDialog();

      // 500 mg of Metformin is a tablet, not something with a draw volume.
      expect(screen.queryByTestId('med-draw')).not.toBeInTheDocument();
    });
  });

  // `custom_fields` is one JSONB column shared with mobile and with older rows, and the
  // server replaces it wholesale. Everything this dialog does not name has to survive.
  describe('custom_fields merge', () => {
    it('preserves keys it does not own while clearing the ones it does', () => {
      const enrichedMed = {
        ...mirroredMed,
        id: 'med-enriched',
        is_glp1: false,
        custom_fields: {
          // Written by another surface; this dialog has no field for it.
          pharmacy_note: 'blue lid',
          // A leftover from when the row was marked GLP-1.
          glp1_drug: 'semaglutide',
          custom_glp1_name: 'old name',
        },
      } as unknown as Medication;

      render(<AddMedicationDialog editMed={enrichedMed} />);
      openDialog();
      save();

      const fields = lastUpdateArgs().body.custom_fields as Record<
        string,
        unknown
      >;
      expect(fields['pharmacy_note']).toBe('blue lid');
      // Null rather than left behind: a merged object keeps whatever it is not told to change,
      // so untoggling GLP-1 has to say so explicitly.
      expect(fields['glp1_drug']).toBeNull();
      expect(fields['custom_glp1_name']).toBeNull();
      expect(fields['reconstitution']).toBeNull();
    });
  });
});
