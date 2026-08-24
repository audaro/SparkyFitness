import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expectedStoredImageFileName } from '../utils/imageDownloader.js';

function urlHash(imageUrl: string): string {
  return crypto.createHash('md5').update(imageUrl).digest('hex').slice(0, 8);
}

// The on-demand /uploads/exercises recovery route resolves a requested
// filename against the upstream record by comparing it to the exact name
// downloadImage would write for the image's canonical URL. Anything else —
// including a fabricated hash suffix — must not resolve, or an
// unauthenticated request could trigger repeated upstream downloads.
describe('expectedStoredImageFileName', () => {
  it('predicts the hash-suffixed name the downloader writes', () => {
    const url = 'https://raw.example/exercises/Bench_Press/0.jpg';
    expect(expectedStoredImageFileName(url)).toBe(`0_${urlHash(url)}.jpg`);
  });

  it('derives a different name for a different URL with the same basename', () => {
    const a = 'https://raw.example/exercises/A/0.jpg';
    const b = 'https://raw.example/exercises/B/0.jpg';
    expect(expectedStoredImageFileName(a)).not.toBe(
      expectedStoredImageFileName(b)
    );
  });

  it('never matches a fabricated hash suffix', () => {
    const url = 'https://raw.example/exercises/Bench_Press/0.jpg';
    expect(expectedStoredImageFileName(url)).not.toBe('0_deadbeef.jpg');
  });

  it('sanitizes the stem the way the downloader does', () => {
    const url = 'https://raw.example/exercises/Foo/im(age).jpg';
    expect(expectedStoredImageFileName(url)).toBe(
      `im_age__${urlHash(url)}.jpg`
    );
  });

  it('returns null when the URL carries no recognized image extension', () => {
    expect(
      expectedStoredImageFileName('https://raw.example/exercises/Foo/image')
    ).toBeNull();
  });
});
