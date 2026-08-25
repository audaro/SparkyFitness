import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { pressAction } from './helpers/nativeHeaderTestUtils';
import MedicationFormScreen from '../../src/screens/MedicationFormScreen';
import {
  useMedications,
  useMedicationDetail,
  useCreateMedication,
  useUpdateMedication,
} from '../../src/hooks/useMedications';
import type { MedicationDetail } from '@workspace/shared';
import type { RootStackScreenProps } from '../../src/types/navigation';

type ScreenProps = RootStackScreenProps<'MedicationForm'>;

jest.mock('../../src/hooks/useMedications', () => ({
  useMedicationDetail: jest.fn(),
  useCreateMedication: jest.fn(),
  useUpdateMedication: jest.fn(),
  // Tier 1 of the name suggestions. Empty here so these tests are not competing with a
  // dropdown; the catalog suite below supplies its own rows.
  useMedications: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));

jest.mock('../../src/components/BottomSheetPicker', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      options,
      onSelect,
      value,
    }: {
      options: { label: string; value: string }[];
      onSelect: (value: string) => void;
      value: string;
    }) => (
      <View>
        <Text>{options.find((option) => option.value === value)?.label ?? ''}</Text>
        {options.map((option) => (
          <Pressable key={option.value} onPress={() => onSelect(option.value)}>
            <Text>{`opt-${option.value}`}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

const mockNavigation = {
  setOptions: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  dispatch: jest.fn(),
  navigate: jest.fn(),
} as unknown as ScreenProps['navigation'];
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const mockUseMedicationDetail = useMedicationDetail as jest.MockedFunction<
  typeof useMedicationDetail
>;
const mockUseCreateMedication = useCreateMedication as jest.MockedFunction<
  typeof useCreateMedication
>;
const mockUseUpdateMedication = useUpdateMedication as jest.MockedFunction<
  typeof useUpdateMedication
>;

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const baseMed: MedicationDetail = {
  id: 'med-1',
  user_id: 'user-1',
  name: 'Lisinopril',
  display_name: null,
  type_id: 'pill',
  route_id: null,
  strength_value: 10,
  strength_unit: 'mg',
  dose_amount: 1,
  dose_unit: 'tablet',
  reason_text: 'Hypertension',
  effectiveness_rating: null,
  color: null,
  icon: null,
  photo_path: null,
  is_active: true,
  is_quick: false,
  is_glp1: false,
  notes: 'Take with food',
  source: 'manual',
  prescriber: 'Dr. Smith',
  pharmacy: 'Corner Pharmacy',
  custom_fields: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  schedules: [],
};

const renderScreen = (medicationId?: string) => {
  const route: ScreenProps['route'] = {
    key: 'MedicationForm-key',
    name: 'MedicationForm',
    params: medicationId ? { medicationId } : {},
  };
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <MedicationFormScreen navigation={mockNavigation} route={route} />
    </SafeAreaProvider>,
  );
};

describe('MedicationFormScreen — optional text fields', () => {
  const createMutate = jest.fn();
  const updateMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMedicationDetail.mockReturnValue(
      { data: baseMed } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    mockUseCreateMedication.mockReturnValue(
      { mutate: createMutate, isPending: false } as unknown as ReturnType<typeof useCreateMedication>,
    );
    mockUseUpdateMedication.mockReturnValue(
      { mutate: updateMutate, isPending: false } as unknown as ReturnType<typeof useUpdateMedication>,
    );
  });

  it('sends explicit null for cleared fields so the server clears them', () => {
    const screen = renderScreen('med-1');

    fireEvent.changeText(screen.getByPlaceholderText('Blood pressure'), '');
    fireEvent.changeText(screen.getByPlaceholderText('Dr. Ipsum'), '');
    fireEvent.changeText(screen.getByPlaceholderText('Sunny Pharmacy'), '');
    fireEvent.changeText(screen.getByDisplayValue('Take with food'), '');

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: 'med-1',
        body: expect.objectContaining({
          reason_text: null,
          prescriber: null,
          pharmacy: null,
          notes: null,
        }),
      },
      expect.anything(),
    );
  });

  it('treats whitespace-only input as cleared', () => {
    const screen = renderScreen('med-1');

    fireEvent.changeText(screen.getByPlaceholderText('Blood pressure'), '   ');

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith(
      { id: 'med-1', body: expect.objectContaining({ reason_text: null }) },
      expect.anything(),
    );
  });

  it('passes through non-empty values trimmed', () => {
    const screen = renderScreen('med-1');

    fireEvent.changeText(screen.getByPlaceholderText('Blood pressure'), '  Migraines  ');

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: 'med-1',
        body: expect.objectContaining({
          reason_text: 'Migraines',
          prescriber: 'Dr. Smith',
          pharmacy: 'Corner Pharmacy',
          notes: 'Take with food',
        }),
      },
      expect.anything(),
    );
  });

  it('collapses detail fields on create until the Details toggle is expanded', () => {
    mockUseMedicationDetail.mockReturnValue(
      { data: undefined } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    const screen = renderScreen();

    expect(screen.queryByPlaceholderText('Dr. Ipsum')).toBeNull();

    fireEvent.press(screen.getByText('Details'));

    expect(screen.getByPlaceholderText('Dr. Ipsum')).toBeTruthy();
  });

  it('starts with detail fields expanded when the medication has detail content', () => {
    const screen = renderScreen('med-1');

    expect(screen.getByPlaceholderText('Dr. Ipsum')).toBeTruthy();
  });

  it('sends null for empty optional fields on create', () => {
    mockUseMedicationDetail.mockReturnValue(
      { data: undefined } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Metformin');

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Metformin',
        reason_text: null,
        prescriber: null,
        pharmacy: null,
        notes: null,
      }),
      expect.anything(),
    );
  });
});

describe('MedicationFormScreen — catalog autofill', () => {
  const createMutate = jest.fn();
  const mockUseMedications = useMedications as jest.MockedFunction<typeof useMedications>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMedications.mockReturnValue(
      { data: [] } as unknown as ReturnType<typeof useMedications>,
    );
    mockUseMedicationDetail.mockReturnValue(
      { data: undefined } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    mockUseCreateMedication.mockReturnValue(
      { mutate: createMutate, isPending: false } as unknown as ReturnType<typeof useCreateMedication>,
    );
    mockUseUpdateMedication.mockReturnValue(
      { mutate: jest.fn(), isPending: false } as unknown as ReturnType<typeof useUpdateMedication>,
    );
  });

  it('attaches the catalog id and route when a known drug is picked', () => {
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Reta');
    fireEvent.press(screen.getByTestId('med-suggestion-catalog:retatrutide'));

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        // The alias the user typed, not a rename to the generic name.
        name: 'Reta',
        type_id: 'injection',
        route_id: 'subcutaneous',
        source: 'catalog',
        custom_fields: expect.objectContaining({ catalog_id: 'retatrutide' }),
      }),
      expect.anything(),
    );
  });

  it('detaches the catalog id when the name is typed over', () => {
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Reta');
    fireEvent.press(screen.getByTestId('med-suggestion-catalog:retatrutide'));
    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Grey vial #3');

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'manual',
        custom_fields: expect.objectContaining({ catalog_id: null }),
      }),
      expect.anything(),
    );
  });

  it('keeps the typed name on the custom row', () => {
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'BPC-157');
    fireEvent.press(screen.getByTestId('med-suggestion-custom'));

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'BPC-157', source: 'manual' }),
      expect.anything(),
    );
  });

  it('converts a vial into syringe units in the calculator', () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId('open-recon-calculator'));
    fireEvent.changeText(screen.getByTestId('recon-vial'), '10');
    fireEvent.changeText(screen.getByTestId('recon-diluent'), '2');
    fireEvent.changeText(screen.getByTestId('recon-dose'), '2');

    expect(screen.getByTestId('recon-units')).toHaveTextContent(/^40 units/);
  });
});

// A concentration is not a number anyone draws. These cover the round trip that makes it
// one: apply writes the mix down, an edit reopens on it, and the draw sits on the form.
describe('MedicationFormScreen — reconstitution round trip', () => {
  const createMutate = jest.fn();
  const updateMutate = jest.fn();

  const reconMix = {
    vial_amount: 30,
    vial_unit: 'mg',
    diluent_ml: 3,
    syringe: 'U-100',
  };

  const vialMed: MedicationDetail = {
    ...baseMed,
    id: 'med-vial',
    name: 'Retatrutide',
    type_id: 'injection',
    strength_value: 10,
    strength_unit: 'mg/mL',
    dose_amount: 2,
    dose_unit: 'mg',
    custom_fields: { reconstitution: reconMix },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useMedications as jest.MockedFunction<typeof useMedications>).mockReturnValue(
      { data: [] } as unknown as ReturnType<typeof useMedications>,
    );
    mockUseMedicationDetail.mockReturnValue(
      { data: vialMed } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    mockUseCreateMedication.mockReturnValue(
      { mutate: createMutate, isPending: false } as unknown as ReturnType<typeof useCreateMedication>,
    );
    mockUseUpdateMedication.mockReturnValue(
      { mutate: updateMutate, isPending: false } as unknown as ReturnType<typeof useUpdateMedication>,
    );
  });

  it('saves the mix alongside the concentration it produced', () => {
    mockUseMedicationDetail.mockReturnValue(
      { data: undefined } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Grey vial #3');
    fireEvent.press(screen.getByTestId('open-recon-calculator'));
    fireEvent.changeText(screen.getByTestId('recon-vial'), '30');
    fireEvent.changeText(screen.getByTestId('recon-diluent'), '3');
    fireEvent.changeText(screen.getByTestId('recon-dose'), '2');
    fireEvent.press(screen.getByTestId('recon-apply'));

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        // 30 mg in 3 mL: the strength is what a millilitre holds, not what the vial holds.
        strength_value: 10,
        strength_unit: 'mg/mL',
        dose_amount: 2,
        dose_unit: 'mg',
        // Without this the concentration is a dead end — nothing left to say which vial and
        // how much water it came from.
        custom_fields: expect.objectContaining({ reconstitution: reconMix }),
      }),
      expect.anything(),
    );
  });

  it('reopens the calculator on the saved mix when editing', () => {
    const screen = renderScreen('med-vial');

    // No "Reconstituting a vial?" button to press: a row that has a mix opens on it.
    expect(screen.queryByTestId('open-recon-calculator')).toBeNull();
    expect(screen.getByTestId('recon-vial').props.value).toBe('30');
    expect(screen.getByTestId('recon-diluent').props.value).toBe('3');
    // Seeded from the medication's own dose, not from the record.
    expect(screen.getByTestId('recon-dose').props.value).toBe('2');
    // The answer is on screen without the user re-entering anything.
    expect(screen.getByTestId('recon-units')).toHaveTextContent(/^20 units/);
  });

  it('carries the saved mix through an edit that never opens the calculator', () => {
    const screen = renderScreen('med-vial');

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Reta vial #2');
    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: 'med-vial',
        body: expect.objectContaining({
          custom_fields: expect.objectContaining({ reconstitution: reconMix }),
        }),
      },
      expect.anything(),
    );
  });

  it('shows the draw next to the strength and dose it comes from', () => {
    const screen = renderScreen('med-vial');

    expect(screen.getByTestId('med-draw')).toHaveTextContent(
      'Draw 0.2 mL — 20 units on a U-100 syringe',
    );
  });

  it('follows a hand-edited strength rather than the saved mix', () => {
    const screen = renderScreen('med-vial');

    // The user got a different vial and typed the new concentration in directly.
    fireEvent.changeText(screen.getByDisplayValue('10'), '20');

    // 2 mg at 20 mg/mL is half of what it was. A draw derived from the stored 30 mg / 3 mL
    // mix would still read 20 units and send them to twice their dose.
    expect(screen.getByTestId('med-draw')).toHaveTextContent(
      'Draw 0.1 mL — 10 units on a U-100 syringe',
    );
  });

  it('reads the saved syringe rather than assuming U-100', () => {
    mockUseMedicationDetail.mockReturnValue(
      {
        data: {
          ...vialMed,
          custom_fields: { reconstitution: { ...reconMix, syringe: 'U-40' } },
        },
      } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    const screen = renderScreen('med-vial');

    expect(screen.getByTestId('med-draw')).toHaveTextContent(
      'Draw 0.2 mL — 8 units on a U-40 syringe',
    );
  });

  // A mix describes a vial. Picking a different name is picking a different vial.
  it('drops the mix when the name is picked off the catalog', () => {
    const screen = renderScreen('med-vial');

    fireEvent.changeText(screen.getByDisplayValue('Retatrutide'), 'Reta');
    fireEvent.press(screen.getByTestId('med-suggestion-catalog:retatrutide'));

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: 'med-vial',
        body: expect.objectContaining({
          custom_fields: expect.objectContaining({ reconstitution: null }),
        }),
      },
      expect.anything(),
    );
  });

  it('reseeds the open calculator when the name is picked over', () => {
    const screen = renderScreen('med-vial');
    expect(screen.getByTestId('recon-vial').props.value).toBe('30');

    // Retatrutide has no label ladder, so the calculator stays open across this pick —
    // which is exactly when a mounted component would keep the old vial on screen.
    fireEvent.changeText(screen.getByDisplayValue('Retatrutide'), 'Reta');
    fireEvent.press(screen.getByTestId('med-suggestion-catalog:retatrutide'));

    expect(screen.getByTestId('recon-vial').props.value).toBe('');
    expect(screen.getByTestId('recon-diluent').props.value).toBe('');
  });

  it("takes the mix from the user's own row when one is copied", () => {
    const otherVial = {
      ...vialMed,
      id: 'med-other',
      name: 'Tirzepatide',
      strength_value: 5,
      custom_fields: {
        reconstitution: { ...reconMix, vial_amount: 10, diluent_ml: 2 },
      },
    };
    (useMedications as jest.MockedFunction<typeof useMedications>).mockReturnValue(
      { data: [otherVial] } as unknown as ReturnType<typeof useMedications>,
    );
    const screen = renderScreen('med-vial');

    fireEvent.changeText(screen.getByDisplayValue('Retatrutide'), 'Tirz');
    fireEvent.press(screen.getByTestId('med-suggestion-own:med-other'));

    pressAction(screen, mockNavigation, 'Save');

    // The copied row's mix, not the one that was on screen a moment ago — otherwise the
    // strength comes from one medication and the vial behind it from another.
    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: 'med-vial',
        body: expect.objectContaining({
          custom_fields: expect.objectContaining({
            reconstitution: expect.objectContaining({
              vial_amount: 10,
              diluent_ml: 2,
            }),
          }),
        }),
      },
      expect.anything(),
    );
  });

  it('claims no draw for a strength that is not a concentration', () => {
    mockUseMedicationDetail.mockReturnValue(
      { data: baseMed } as unknown as ReturnType<typeof useMedicationDetail>,
    );
    const screen = renderScreen('med-1');

    // 10 mg of Lisinopril is a tablet, not something with a draw volume.
    expect(screen.queryByTestId('med-draw')).toBeNull();
  });
});
