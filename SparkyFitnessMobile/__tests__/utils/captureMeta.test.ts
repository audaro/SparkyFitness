import { buildCaptureMeta } from '../../src/utils/captureMeta';

/**
 * The capture payload is what a later comparison uses to decide whether two
 * photos can be compared at all, so these tests are about one thing: it must
 * never claim to know something it does not.
 */
describe('buildCaptureMeta', () => {
  it('records how a guided shot was framed', () => {
    const meta = buildCaptureMeta({
      mode: 'guided',
      facing: 'front',
      referencePhotoId: 'photo-1',
      referenceOpacity: 0.4,
      timerSeconds: 3,
    });

    expect(meta).toMatchObject({
      v: 1,
      capture_mode: 'guided',
      facing: 'front',
      reference_photo_id: 'photo-1',
      reference_opacity: 0.4,
      timer_seconds: 3,
      device: 'iPhone 15 Pro',
    });
  });

  it('omits what it does not know rather than defaulting it', () => {
    // A library import knows nothing about framing. Absent keys read as
    // "unknown" downstream; a zeroed tilt or a 0% ghost would read as a
    // measurement that was never taken.
    const meta = buildCaptureMeta({ mode: 'library' });

    expect(meta.capture_mode).toBe('library');
    expect(meta).not.toHaveProperty('facing');
    expect(meta).not.toHaveProperty('reference_photo_id');
    expect(meta).not.toHaveProperty('reference_opacity');
    expect(meta).not.toHaveProperty('timer_seconds');
    expect(meta).not.toHaveProperty('pitch_deg');
    expect(meta).not.toHaveProperty('roll_deg');
  });

  it('keeps the local wall clock instead of normalizing to UTC', () => {
    // Time of day moves a body more than a week of training does, so the hour
    // the photo was taken at is the part worth keeping. toISOString() would
    // convert it away.
    const now = new Date(2026, 5, 14, 7, 12, 0);
    const meta = buildCaptureMeta({ mode: 'guided', now });

    expect(meta.local_time).toMatch(/^2026-06-14T07:12:00[+-]\d{2}:\d{2}$/);
  });

  it('pads a single-digit local time', () => {
    const meta = buildCaptureMeta({
      mode: 'guided',
      now: new Date(2026, 0, 5, 6, 7, 8),
    });

    expect(meta.local_time?.startsWith('2026-01-05T06:07:08')).toBe(true);
  });
});
