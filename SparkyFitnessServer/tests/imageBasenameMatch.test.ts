import { describe, expect, it } from 'vitest';
import { matchesUpstreamImageBasename } from '../utils/imageDownloader.js';

// The on-demand /uploads/exercises recovery route looks a requested filename
// up in the upstream free-exercise-db record. Stored filenames carry the
// downloader's URL-hash suffix (`0.jpg` -> `0_ab12cd34.jpg`) while upstream
// lists the plain basename; both must resolve.
describe('matchesUpstreamImageBasename', () => {
  it('matches a verbatim upstream basename', () => {
    expect(matchesUpstreamImageBasename('0.jpg', '0.jpg')).toBe(true);
  });

  it('matches the hash-suffixed form of an upstream basename', () => {
    expect(matchesUpstreamImageBasename('0.jpg', '0_ab12cd34.jpg')).toBe(true);
  });

  it('rejects a hash-suffixed name for a different upstream stem', () => {
    expect(matchesUpstreamImageBasename('1.jpg', '0_ab12cd34.jpg')).toBe(false);
  });

  it('rejects a hash-suffixed name with a different extension', () => {
    expect(matchesUpstreamImageBasename('0.png', '0_ab12cd34.jpg')).toBe(false);
  });

  it('rejects an unrelated filename without a hash suffix', () => {
    expect(matchesUpstreamImageBasename('0.jpg', '1.jpg')).toBe(false);
  });

  it('compares against the sanitized upstream stem the downloader writes', () => {
    // resolveImageFileName rewrites disallowed stem characters to `_` before
    // appending the hash, so the match must apply the same rewrite.
    expect(
      matchesUpstreamImageBasename('im age.jpg', 'im_age_ab12cd34.jpg')
    ).toBe(true);
  });
});
