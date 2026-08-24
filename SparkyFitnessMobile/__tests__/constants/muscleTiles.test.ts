import { MUSCLES } from '@workspace/shared';

import {
  MUSCLE_TILES,
  MUSCLE_TILE_SECTIONS,
  musclesForTiles,
} from '../../src/constants/muscleTiles';

describe('muscle tiles', () => {
  // The whole point of the grid is that every muscle the engine knows about is
  // pickable. A muscle added upstream must fail here rather than silently
  // become unreachable, the way the group partition is asserted server-side in
  // tests/weeklySetTargets.test.ts.
  it('gives every canonical muscle exactly one tile', () => {
    const covered = MUSCLE_TILES.flatMap((tile) => tile.muscles);

    expect([...covered].sort()).toEqual([...MUSCLES].sort());
    expect(new Set(covered).size).toBe(MUSCLES.length);
  });

  it('keeps tile ids unique', () => {
    const ids = MUSCLE_TILES.map((tile) => tile.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('splits the vocabulary into ten main tiles and six accessory ones', () => {
    const [main, accessory] = MUSCLE_TILE_SECTIONS;

    expect(main.title).toBe('Main');
    expect(main.tiles).toHaveLength(10);
    expect(main.tiles.flatMap((tile) => tile.muscles)).toHaveLength(11);
    expect(accessory.title).toBe('Accessory');
    expect(accessory.tiles).toHaveLength(6);
    expect(accessory.tiles.flatMap((tile) => tile.muscles)).toHaveLength(6);
  });

  // Display grouping only: the wire never learns the word "back".
  it('resolves the back tile to both canonical back muscles', () => {
    expect(musclesForTiles(['back'])).toEqual(['lats', 'middle back']);
  });

  it('returns muscles in canonical order regardless of tap order', () => {
    expect(musclesForTiles(['triceps', 'chest'])).toEqual(['chest', 'triceps']);
    expect(musclesForTiles(['chest', 'triceps'])).toEqual(['chest', 'triceps']);
  });

  it('de-duplicates and ignores unknown tile ids', () => {
    expect(musclesForTiles(['chest', 'chest', 'not-a-tile'])).toEqual(['chest']);
    expect(musclesForTiles([])).toEqual([]);
  });

  it('resolves every tile to canonical muscle strings', () => {
    for (const tile of MUSCLE_TILES) {
      for (const muscle of tile.muscles) {
        expect(MUSCLES).toContain(muscle);
      }
    }
  });
});
