import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import CustomTabBar from '../../src/components/CustomTabBar';

// SF Symbols and Ionicons render nothing queryable, so stand in something that
// names the icon the bar asked for.
jest.mock('../../src/components/Icon', () => {
  const ReactActual = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  const MockIcon = ({ name }: { name: string }) =>
    ReactActual.createElement(Text, { testID: `icon-${name}` }, name);
  return { __esModule: true, default: MockIcon };
});

describe('CustomTabBar', () => {
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };

  const createProps = (): BottomTabBarProps => {
    const routes = [
      { key: 'Home-key', name: 'Home' as const, params: undefined },
      { key: 'Exercise-key', name: 'Exercise' as const, params: undefined },
      { key: 'Add-key', name: 'Add' as const, params: undefined },
      { key: 'Food-key', name: 'Food' as const, params: undefined },
      { key: 'Settings-key', name: 'Settings' as const, params: undefined },
    ];

    const emit = jest.fn(({ target }: { target: string }) => ({
      defaultPrevented: target === 'Add-key',
    }));

    return {
      state: {
        stale: false,
        type: 'tab',
        key: 'tab-state',
        index: 0,
        routeNames: routes.map(route => route.name),
        history: [],
        routes,
      },
      descriptors: Object.fromEntries(
        routes.map(route => [
          route.key,
          {
            navigation: {} as never,
            route,
            options: route.name === 'Add'
              ? { tabBarAccessibilityLabel: 'Add' }
              : { title: route.name },
            render: jest.fn(),
          },
        ]),
      ) as BottomTabBarProps['descriptors'],
      navigation: {
        emit,
        navigate: jest.fn(),
      } as unknown as BottomTabBarProps['navigation'],
      insets,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the Add tab press without navigating when the Add button is pressed', () => {
    const props = createProps();
    const screen = render(
      <SafeAreaProvider initialMetrics={{ insets, frame }}>
        <CustomTabBar {...props} />
      </SafeAreaProvider>,
    );

    fireEvent.press(screen.getByLabelText('Add'));

    expect(props.navigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'Add-key',
      canPreventDefault: true,
    });
    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });

  // TAB_ICONS is keyed by route name, so a renamed tab whose icon entry was not
  // renamed with it drops the icon and leaves a label-only tab. Typecheck now
  // catches a missing key; this catches the bar not drawing what it was given.
  it('renders an icon for every tab except Add', () => {
    const props = createProps();
    const screen = render(
      <SafeAreaProvider initialMetrics={{ insets, frame }}>
        <CustomTabBar {...props} />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('icon-tab-dashboard')).toBeTruthy();
    expect(screen.getByTestId('icon-exercise-weights')).toBeTruthy();
    expect(screen.getByTestId('icon-food')).toBeTruthy();
    expect(screen.getByTestId('icon-settings')).toBeTruthy();
    expect(screen.getByTestId('icon-add')).toBeTruthy();
  });
});
