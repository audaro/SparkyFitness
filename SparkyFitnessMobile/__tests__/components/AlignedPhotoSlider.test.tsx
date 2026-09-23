import { act, fireEvent, render } from '@testing-library/react-native';
import { Image } from 'expo-image';
import AlignedPhotoSlider from '../../src/components/AlignedPhotoSlider';

const SLIDER_LABEL =
  'Before and after, aligned. Swipe up or down to move the divider.';

const renderSlider = () =>
  render(
    <AlignedPhotoSlider
      before="data:image/jpeg;base64,BEFORE"
      after="data:image/jpeg;base64,AFTER"
      aspectRatio={0.75}
    />
  );

/** Give the frame a measured width, as layout would on a device. */
const layout = (element: ReturnType<typeof renderSlider>, width = 300) =>
  act(() => {
    fireEvent(element.getByLabelText(SLIDER_LABEL), 'layout', {
      nativeEvent: { layout: { width, height: width / 0.75 } },
    });
  });

describe('AlignedPhotoSlider', () => {
  it('draws both frames at the same size', () => {
    // The alignment's whole promise is that these two differ only where the
    // body differs. Two layers at different sizes would draw a change that is
    // not in either photograph.
    const view = renderSlider();
    layout(view);

    const images = view.UNSAFE_getAllByType(Image);
    const uris = images.map(
      (image) => (image.props.source as { uri: string }).uri
    );

    expect(uris).toEqual([
      'data:image/jpeg;base64,AFTER',
      'data:image/jpeg;base64,BEFORE',
    ]);
  });

  it('gives the clipped frame a fixed width rather than a stretching one', () => {
    // The before frame lives inside a container whose width is the divider.
    // A percentage width there would squash the photo as the divider moved.
    const view = renderSlider();
    layout(view, 300);

    const [, clipped] = view.UNSAFE_getAllByType(Image);

    expect(clipped.props.style).toMatchObject({ width: 300 });
  });

  it('is adjustable without a drag', () => {
    // A divider a screen reader user cannot move is a picture they can only
    // ever see half of.
    const view = renderSlider();
    layout(view);
    const frame = view.getByLabelText(SLIDER_LABEL);

    expect(frame.props.accessibilityRole).toBe('adjustable');
    expect(frame.props.accessibilityValue.text).toBe('50% before');

    act(() => {
      fireEvent(frame, 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });

    expect(
      view.getByLabelText(SLIDER_LABEL).props.accessibilityValue.text
    ).toBe('60% before');
  });

  it('does not let the divider walk off either edge', () => {
    const view = renderSlider();
    layout(view);
    const frame = () => view.getByLabelText(SLIDER_LABEL);

    for (let i = 0; i < 12; i++) {
      act(() => {
        fireEvent(frame(), 'accessibilityAction', {
          nativeEvent: { actionName: 'decrement' },
        });
      });
    }

    expect(frame().props.accessibilityValue.text).toBe('0% before');

    for (let i = 0; i < 20; i++) {
      act(() => {
        fireEvent(frame(), 'accessibilityAction', {
          nativeEvent: { actionName: 'increment' },
        });
      });
    }

    expect(frame().props.accessibilityValue.text).toBe('100% before');
  });
});
