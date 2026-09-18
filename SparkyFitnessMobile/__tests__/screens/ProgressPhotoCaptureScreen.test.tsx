import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ProgressPhotoCaptureScreen from '../../src/screens/ProgressPhotoCaptureScreen';
import {
  useCheckInPhotoGallery,
  useCheckInPhotoMutations,
} from '../../src/hooks/useCheckInPhotos';
import { useCheckInPhotoSource } from '../../src/hooks/useCheckInPhotoSource';
import type { ProgressPhotoDay } from '../../src/types/checkInPhotos';

jest.mock('../../src/hooks/useCheckInPhotos', () => ({
  useCheckInPhotoGallery: jest.fn(),
  useCheckInPhotoMutations: jest.fn(),
}));
jest.mock('../../src/hooks/useCheckInPhotoSource', () => ({
  useCheckInPhotoSource: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The downscale step re-encodes through the native image manipulator; the
// screen's contract is what it uploads, not how the bytes were shrunk.
jest.mock('../../src/utils/pickImage', () => ({
  downscale: jest.fn((asset: { uri: string }) =>
    Promise.resolve({ uri: `${asset.uri}-small` })
  ),
}));

// The ghost overlay is a real SafeImage over an authenticated URL, which never
// paints under jsdom. The screen now waits on that paint before it will fire,
// so the tests have to say whether it painted: true = shown, false = every
// retry failed, null = still loading.
let mockGhostSettles: boolean | null = true;
jest.mock('../../src/components/SafeImage', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: function MockSafeImage({
      onSettled,
    }: {
      onSettled?: (visible: boolean) => void;
    }) {
      // Mount-only: the screen passes an inline arrow, so depending on it
      // would re-run this on every render.
      ReactLocal.useEffect(() => {
        if (mockGhostSettles === null) return;
        onSettled?.(mockGhostSettles);
      }, []);
      return ReactLocal.createElement(View, { testID: 'ghost-overlay' });
    },
  };
});

const mockTakePictureAsync = jest.fn();
jest.mock('expo-camera', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    CameraView: ReactLocal.forwardRef(
      (
        { children, ...props }: { children?: React.ReactNode },
        ref: React.Ref<unknown>
      ) => {
        ReactLocal.useImperativeHandle(ref, () => ({
          takePictureAsync: (...args: unknown[]) =>
            mockTakePictureAsync(...args),
        }));
        return ReactLocal.createElement(
          View,
          { testID: 'camera-view', ...props },
          children
        );
      }
    ),
    useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn()]),
  };
});

const mockUseGallery = useCheckInPhotoGallery as jest.MockedFunction<
  typeof useCheckInPhotoGallery
>;
const mockUseMutations = useCheckInPhotoMutations as jest.MockedFunction<
  typeof useCheckInPhotoMutations
>;
const mockUseSource = useCheckInPhotoSource as jest.MockedFunction<
  typeof useCheckInPhotoSource
>;

const uploadAsync = jest.fn().mockResolvedValue({ id: 'new-photo' });
const navigation = { goBack: jest.fn(), navigate: jest.fn() };

const dayWith = (
  entry_date: string,
  angles: ('front' | 'back' | 'side')[]
): ProgressPhotoDay => ({
  entry_date,
  weight: null,
  photos: Object.fromEntries(
    angles.map((angle) => [
      angle,
      {
        id: `${entry_date}-${angle}`,
        entry_date,
        photo_type: angle,
        weight: null,
      },
    ])
  ),
});

const renderScreen = (
  params = { date: '2026-06-14', angle: 'front' as const }
) =>
  render(
    <ProgressPhotoCaptureScreen
      // The screen only reads `params` and the two navigation methods asserted
      // below; a full navigator would add nothing to these assertions.
      navigation={navigation as never}
      route={{ key: 'k', name: 'ProgressPhotoCapture', params } as never}
    />
  );

describe('ProgressPhotoCaptureScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGhostSettles = true;
    // Newest day first, which is the order the gallery hook returns.
    mockUseGallery.mockReturnValue({
      days: [
        dayWith('2026-06-14', ['front']),
        dayWith('2026-06-07', ['front', 'side']),
        dayWith('2026-05-31', ['front']),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useCheckInPhotoGallery>);
    mockUseMutations.mockReturnValue({
      uploadAsync,
      isUploading: false,
      uploadingType: undefined,
      deleteAsync: jest.fn(),
      isDeleting: false,
    } as unknown as ReturnType<typeof useCheckInPhotoMutations>);
    mockUseSource.mockReturnValue({
      getPhotoSource: (id: string) => ({ uri: `https://x/${id}`, headers: {} }),
    } as unknown as ReturnType<typeof useCheckInPhotoSource>);
    mockTakePictureAsync.mockResolvedValue({
      uri: 'file:///shot.jpg',
      width: 3000,
      height: 4000,
    });
  });

  it('uploads the shot with the conditions it was taken under', async () => {
    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    await waitFor(() => expect(uploadAsync).toHaveBeenCalled());
    const call = uploadAsync.mock.calls[0][0];
    expect(call).toMatchObject({
      date: '2026-06-14',
      type: 'front',
      // Downscaled before upload: a raw camera frame can exceed the server's
      // 10 MB limit and is HEIC on iOS, which the allowlist rejects.
      uri: 'file:///shot.jpg-small',
    });
    expect(call.captureMeta).toMatchObject({
      v: 1,
      capture_mode: 'guided',
      facing: 'front',
      timer_seconds: 0,
      reference_opacity: 0.4,
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('frames against the previous shoot, not the one being replaced', async () => {
    // 2026-06-14 already has a front photo, and this screen is capturing that
    // same day. Ghosting it would align the retake to the mistake rather than
    // to the series, so the reference must be the shoot before it.
    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    await waitFor(() => expect(uploadAsync).toHaveBeenCalled());
    expect(uploadAsync.mock.calls[0][0].captureMeta.reference_photo_id).toBe(
      '2026-06-07-front'
    );
  });

  it('claims no reference when this is the first shot at the angle', async () => {
    mockUseGallery.mockReturnValue({
      days: [dayWith('2026-06-07', ['side'])],
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useCheckInPhotoGallery>);

    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    await waitFor(() => expect(uploadAsync).toHaveBeenCalled());
    const meta = uploadAsync.mock.calls[0][0].captureMeta;
    expect(meta.reference_photo_id).toBeUndefined();
    // No ghost was shown, so there is no opacity to report. Recording one would
    // describe framing the user never saw.
    expect(meta.reference_opacity).toBeUndefined();
  });

  it('runs the self-timer before firing the shutter', async () => {
    jest.useFakeTimers();
    try {
      const { getByLabelText } = renderScreen();

      // One press moves the stop from Off to 3s.
      fireEvent.press(getByLabelText('Self-timer'));
      fireEvent.press(getByLabelText('Take photo'));

      expect(mockTakePictureAsync).not.toHaveBeenCalled();

      // Each second is its own timeout, scheduled by the render that showed the
      // previous number — so advancing 3000ms in one step would fire only the
      // first of them and leave the countdown stuck at 2.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
      }

      expect(mockTakePictureAsync).toHaveBeenCalled();
      expect(uploadAsync.mock.calls[0][0].captureMeta.timer_seconds).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('holds the shutter until the ghost has painted', async () => {
    // Between opening the screen and the reference photo arriving there is
    // nothing on the overlay. A shot fired then is framed against an empty
    // screen while the metadata would claim it lined up with a photo.
    mockGhostSettles = null;
    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    expect(mockTakePictureAsync).not.toHaveBeenCalled();
    expect(uploadAsync).not.toHaveBeenCalled();
  });

  it('holds the shutter until the gallery has answered', async () => {
    // Same window, earlier: with no days loaded yet the screen cannot know
    // whether there is a reference at all, and would claim this is a first
    // shot.
    mockUseGallery.mockReturnValue({
      days: [],
      isLoading: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useCheckInPhotoGallery>);

    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    expect(mockTakePictureAsync).not.toHaveBeenCalled();
  });

  it('shoots without a reference when the ghost cannot be loaded', async () => {
    // An unreachable reference photo must not disable the shutter for good -
    // shooting unguided beats not shooting - but the shot did not line up
    // with anything, and must not say it did.
    mockGhostSettles = false;
    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    await waitFor(() => expect(uploadAsync).toHaveBeenCalled());
    const meta = uploadAsync.mock.calls[0][0].captureMeta;
    expect(meta.reference_photo_id).toBeUndefined();
    expect(meta.reference_opacity).toBeUndefined();
  });

  it('does not upload when the camera returns nothing', async () => {
    mockTakePictureAsync.mockResolvedValue(undefined);
    const { getByLabelText } = renderScreen();

    await act(async () => {
      fireEvent.press(getByLabelText('Take photo'));
    });

    expect(uploadAsync).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
