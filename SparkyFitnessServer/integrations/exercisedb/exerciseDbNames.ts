/**
 * Display-name cleanup for ExerciseDB-mirror records. The mirror's names are
 * all-lowercase catalog jargon ("lever lateral raise" for the leverage-machine
 * station, "smith squat", "sled 45в° leg press (back pov)" with mojibake and
 * camera-angle suffixes), which reads poorly next to the local catalog's
 * "Leg Press" style. This maps the mirror's naming conventions onto plain gym
 * names at import time; the raw name is not stored anywhere, so the function
 * is deliberately idempotent — applying it to an already-clean name is a
 * no-op, letting membership listing and the record mapper each clean
 * independently.
 *
 * Duplicate-name collapse is intended: the two upstream double-entries and
 * the "(back pov)"/"(side pov)" re-films of one movement clean to identical
 * names, and the pack importer's name dedup then keeps a single copy.
 */

const SMALL_WORDS = new Set([
  'a',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
]);

function titleCase(name: string): string {
  return name
    .split(' ')
    .map((word, index) => {
      const bare = word.replace(/[()]/g, '').toLowerCase();
      if (index > 0 && SMALL_WORDS.has(bare) && !word.startsWith('(')) {
        return bare;
      }
      // Capitalize every letter-run so hyphenated parts each get a capital:
      // "close-grip" -> "Close-Grip", "(kneeling)" -> "(Kneeling)".
      return word.replace(
        /[a-zA-Z][a-zA-Z']*/g,
        (part) => part.charAt(0).toUpperCase() + part.slice(1)
      );
    })
    .join(' ');
}

export function cleanExerciseDbExerciseName(raw: string): string {
  let name = String(raw).trim().replace(/\s+/g, ' ');
  // Upstream mojibake for the degree sign, plus its spelled-out sibling.
  name = name.replace(/в°/g, '°');
  name = name.replace(/\b45 degrees\b/gi, '45°');
  // Camera-angle suffixes mark re-films of the same movement, not variants.
  name = name.replace(/\s*\((?:back|side|front) pov\)/gi, '');
  let variation: string | null = null;
  const versionMatch = name.match(/\s+v\.\s*(\d+)$/i);
  if (versionMatch) {
    variation = versionMatch[1];
    name = name.slice(0, versionMatch.index);
  }
  name = name.replace(/\bt bar\b/gi, 't-bar');
  const lower = name.toLowerCase();
  if (lower.startsWith('lever ')) {
    // "lever" is the catalog's word for a leverage machine. Skip the prefix
    // when the rest already says machine ("…on leg press machine") so no name
    // ends up saying it twice.
    const rest = name.slice('lever '.length);
    name = rest.toLowerCase().includes('machine') ? rest : `machine ${rest}`;
  } else if (lower.startsWith('smith machine ')) {
    // Already carries the full station name.
  } else if (lower.startsWith('smith ')) {
    name = `smith machine ${name.slice('smith '.length)}`;
  } else if (lower.startsWith('sled ')) {
    // "sled" tags the 45° leg press / hack squat family; the rest of the
    // name is already what the station is called.
    name = name.slice('sled '.length);
  }
  const cleaned = titleCase(name);
  if (!cleaned) {
    return String(raw).trim();
  }
  return variation ? `${cleaned} (Variation ${variation})` : cleaned;
}
