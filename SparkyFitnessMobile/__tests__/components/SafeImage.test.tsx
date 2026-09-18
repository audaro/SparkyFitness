import { Image } from 'expo-image';
import { act, render } from '@testing-library/react-native';
import SafeImage from '../../src/components/SafeImage';

const source = {
  uri: 'https://server/uploads/exercises/demo/0.gif',
  headers: {},
};

describe('SafeImage autoplay', () => {
  it('holds animated formats on their first frame by default', () => {
    // Regression: animated GIF exercise images used to loop inside list
    // thumbnails everywhere SafeImage is used, because expo-image autoplays
    // unless told otherwise.
    const { UNSAFE_getByType } = render(
      <SafeImage source={source} style={{ width: 42, height: 42 }} />
    );

    expect(UNSAFE_getByType(Image).props.autoplay).toBe(false);
  });

  it('plays animated formats when the caller opts in', () => {
    const { UNSAFE_getByType } = render(
      <SafeImage source={source} style={{ width: 42, height: 42 }} autoplay />
    );

    expect(UNSAFE_getByType(Image).props.autoplay).toBe(true);
  });
});

describe('SafeImage onSettled', () => {
  it('reports the image as visible once it paints', () => {
    const onSettled = jest.fn();
    const { UNSAFE_getByType } = render(
      <SafeImage
        source={source}
        style={{ width: 42, height: 42 }}
        onSettled={onSettled}
      />
    );

    expect(onSettled).not.toHaveBeenCalled();

    act(() => UNSAFE_getByType(Image).props.onLoad());

    expect(onSettled).toHaveBeenCalledWith(true);
  });

  it('reports a terminal failure as not visible', () => {
    jest.useFakeTimers();
    try {
      const onSettled = jest.fn();
      const { UNSAFE_getByType } = render(
        <SafeImage
          source={source}
          style={{ width: 42, height: 42 }}
          onSettled={onSettled}
        />
      );

      // Each retry is its own backoff timeout, so they have to be walked one
      // at a time. A failure with retries left is not an answer yet - the
      // image may still paint - so nothing is reported until the last one.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        act(() => UNSAFE_getByType(Image).props.onError());
        expect(onSettled).not.toHaveBeenCalled();
        act(() => {
          jest.advanceTimersByTime(5000);
        });
      }

      act(() => UNSAFE_getByType(Image).props.onError());

      expect(onSettled).toHaveBeenCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
