import type { NativeStackHeaderItemButton } from '@react-navigation/native-stack';

import {
  createNativeHeaderDatePickerItems,
  setNativeHeaderDatePickerOptions,
} from '../../src/utils/nativeHeaderDatePicker';

describe('nativeHeaderDatePicker', () => {
  const onPreviousDate = jest.fn();
  const onDatePress = jest.fn();
  const onNextDate = jest.fn();
  const options = {
    selectedDate: '2025-01-15',
    onPreviousDate,
    onDatePress,
    onNextDate,
    tintColor: '#0A84FF',
    accessibilityLabel: 'Choose diary date',
    // The picker only reads `t` for the optional label overrides, which these
    // cases leave unset, so the identity function is enough.
    t: ((key: string) => key) as unknown as import('i18next').TFunction,
    locale: 'en',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates tappable accent-colored date controls', () => {
    // Every item the picker builds is a button; the union needs saying so before
    // its button-only fields are readable.
    const items = createNativeHeaderDatePickerItems(
      options,
    ) as NativeStackHeaderItemButton[];

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.identifier)).toEqual([
      'date-picker-previous',
      'date-picker',
      'date-picker-next',
    ]);
    expect(items.every((item) => item.tintColor === '#0A84FF')).toBe(true);
    expect(items[1]?.label).toContain('Jan 15');

    items[0]?.onPress?.();
    items[1]?.onPress?.();
    items[2]?.onPress?.();

    expect(onPreviousDate).toHaveBeenCalledTimes(1);
    expect(onDatePress).toHaveBeenCalledTimes(1);
    expect(onNextDate).toHaveBeenCalledTimes(1);
  });

  it('writes handlers to screen options instead of route params', () => {
    const setOptions = jest.fn();

    setNativeHeaderDatePickerOptions({ setOptions }, options);

    expect(setOptions).toHaveBeenCalledTimes(1);
    const configuredOptions = setOptions.mock.calls[0]?.[0];
    expect(configuredOptions).toEqual({
      unstable_headerRightItems: expect.any(Function),
    });
    expect(configuredOptions.unstable_headerRightItems()).toHaveLength(3);
  });
});
