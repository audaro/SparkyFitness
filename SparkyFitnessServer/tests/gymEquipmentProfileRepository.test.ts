import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import gymEquipmentProfileRepository from '../models/gymEquipmentProfileRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
}));

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  name: 'Home',
  equipment: ['dumbbell', 'bands'],
  is_active: true,
  created_at: new Date('2026-08-23T10:00:00.000Z'),
  updated_at: new Date('2026-08-23T10:00:00.000Z'),
};

describe('gymEquipmentProfileRepository', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    mockClient = { query: vi.fn(), release: vi.fn() };
    // @ts-expect-error mock typing
    getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryTexts = (): string[] =>
    mockClient.query.mock.calls.map((call: any[]) => call[0]);

  describe('listGymProfiles', () => {
    it('scopes to the user and returns the active profile first', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      const result =
        await gymEquipmentProfileRepository.listGymProfiles('user-1');

      expect(result).toEqual([ROW]);
      expect(mockClient.query).toHaveBeenCalledWith(expect.any(String), [
        'user-1',
      ]);
      expect(queryTexts()[0]).toContain('ORDER BY is_active DESC');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('getActiveGymProfile', () => {
    it('returns the active row', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      const result =
        await gymEquipmentProfileRepository.getActiveGymProfile('user-1');

      expect(result).toEqual(ROW);
      expect(queryTexts()[0]).toContain('is_active');
    });

    it('returns null when the user has no active profile', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result =
        await gymEquipmentProfileRepository.getActiveGymProfile('user-1');

      expect(result).toBeNull();
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('createGymProfile', () => {
    it('serializes the equipment array as jsonb', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: ['dumbbell', 'bands'],
      });

      const insert = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      expect(insert[0]).toContain('$3::jsonb');
      expect(insert[1]).toEqual([
        'user-1',
        'Home',
        JSON.stringify(['dumbbell', 'bands']),
        null,
        null,
        null,
        // equipment_preference: a TEXT column, so an unstated preference binds
        // as SQL NULL directly rather than through toJsonbParam.
        null,
        false,
      ]);
    });

    it('stores omitted apparatus as SQL NULL, not the jsonb string "null"', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: [],
      });

      const insert = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      // JSON.stringify(undefined ?? null) would yield the string "null",
      // which `::jsonb` stores as jsonb null — a different value from SQL
      // NULL, and one that breaks the tri-state "never stated" contract.
      expect(insert[1][3]).toBeNull();
      expect(insert[1][3]).not.toBe('null');
    });

    it('serializes stated apparatus as jsonb', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: ['dumbbell'],
        apparatus: ['bench', 'pull-up bar'],
      });

      const insert = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      expect(insert[0]).toContain('$4::jsonb');
      expect(insert[1][3]).toBe(JSON.stringify(['bench', 'pull-up bar']));
    });

    it('serializes load limits as jsonb, and their absence as SQL NULL', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: ['dumbbell'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
      });

      const insert = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      expect(insert[0]).toContain('$6::jsonb');
      expect(insert[1][5]).toBe(JSON.stringify({ dumbbell: { max_kg: 22.5 } }));

      mockClient.query.mockClear();
      mockClient.query.mockResolvedValue({ rows: [ROW] });
      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Bare',
        equipment: [],
      });
      const bare = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      expect(bare[1][5]).toBeNull();
    });

    it('serializes stated equipment items as jsonb, absence as SQL NULL', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'PF',
        equipment: ['dumbbell', 'machine'],
        apparatus: ['bench'],
        equipment_items: ['dumbbells', 'smith-machine', 'flat-bench'],
      });

      const insert = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      expect(insert[0]).toContain('$5::jsonb');
      expect(insert[1][4]).toBe(
        JSON.stringify(['dumbbells', 'smith-machine', 'flat-bench'])
      );

      mockClient.query.mockClear();
      mockClient.query.mockResolvedValue({ rows: [ROW] });
      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Legacy',
        equipment: [],
      });
      const legacy = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('INSERT INTO gym_equipment_profiles')
      );
      // SQL NULL, never the jsonb string "null" — same tri-state contract
      // as apparatus: NULL means "never stated", and a legacy write must
      // leave the profile in coarse mode.
      expect(legacy[1][4]).toBeNull();
      expect(legacy[1][4]).not.toBe('null');
    });

    it('does not touch other rows when the new profile is inactive', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: [],
        is_active: false,
      });

      expect(
        queryTexts().some((text) => text.includes('SET is_active = FALSE'))
      ).toBe(false);
    });

    it('clears the previous active row before inserting an active one', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: ['dumbbell'],
        is_active: true,
      });

      const texts = queryTexts();
      const clearIndex = texts.findIndex((text) =>
        text.includes('SET is_active = FALSE')
      );
      const insertIndex = texts.findIndex((text) =>
        text.includes('INSERT INTO gym_equipment_profiles')
      );
      // The partial unique index rejects two active rows, so the clear must
      // land first and both writes must share one transaction.
      expect(texts[0]).toBe('BEGIN');
      expect(clearIndex).toBeGreaterThan(0);
      expect(clearIndex).toBeLessThan(insertIndex);
      expect(texts[texts.length - 1]).toBe('COMMIT');
    });

    it('rolls back and rethrows when the insert fails', async () => {
      const failure = Object.assign(new Error('duplicate key'), {
        code: '23505',
      });
      mockClient.query.mockImplementation((text: string) =>
        text.includes('INSERT INTO')
          ? Promise.reject(failure)
          : Promise.resolve({ rows: [] })
      );

      await expect(
        gymEquipmentProfileRepository.createGymProfile('user-1', {
          name: 'Home',
          equipment: [],
        })
      ).rejects.toThrow('duplicate key');
      expect(queryTexts()).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateGymProfile', () => {
    it('writes only the provided keys', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {
        name: 'Garage',
      });

      const [text, params] = mockClient.query.mock.calls[0];
      // A full-row UPDATE would blank equipment; only `name` may appear.
      expect(text).toContain('name = $3');
      expect(text).not.toContain('equipment =');
      expect(params).toEqual(['user-1', ROW.id, 'Garage']);
    });

    it('casts equipment to jsonb when it is part of the patch', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {
        name: 'Garage',
        equipment: ['barbell'],
      });

      const [text, params] = mockClient.query.mock.calls[0];
      expect(text).toContain('equipment = $4::jsonb');
      expect(params[3]).toBe(JSON.stringify(['barbell']));
    });

    it('serializes an empty apparatus array as jsonb [] — stated none', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {
        apparatus: [],
      });

      const [text, params] = mockClient.query.mock.calls[0];
      expect(text).toContain('apparatus = $3::jsonb');
      expect(params[2]).toBe('[]');
    });

    it('writes SQL NULL when apparatus is cleared, not the jsonb string "null"', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {
        apparatus: null,
      });

      const [text, params] = mockClient.query.mock.calls[0];
      expect(text).toContain('apparatus = $3::jsonb');
      // The string "null" would survive `::jsonb` as jsonb null — reads would
      // see a non-SQL-NULL value and the engine would stop inferring.
      expect(params[2]).toBeNull();
      expect(params[2]).not.toBe('null');
    });

    it('serializes an equipment-items patch, and clears it to SQL NULL', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.updateGymProfile('user-1', 'p1', {
        equipment_items: ['cable-tower'],
        equipment: ['cable'],
        apparatus: [],
      });
      let update = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('UPDATE gym_equipment_profiles')
      );
      expect(update[0]).toContain('equipment_items = $5::jsonb');
      expect(update[1]).toContain(JSON.stringify(['cable-tower']));

      mockClient.query.mockClear();
      mockClient.query.mockResolvedValue({ rows: [ROW] });
      await gymEquipmentProfileRepository.updateGymProfile('user-1', 'p1', {
        equipment_items: null,
      });
      update = mockClient.query.mock.calls.find((call: string[]) =>
        call[0].includes('UPDATE gym_equipment_profiles')
      );
      // Dropping back to coarse mode is SQL NULL, not jsonb "null".
      expect(update[1][2]).toBeNull();
      expect(update[1][2]).not.toBe('null');
    });

    it('serializes a load-limits patch, and clears it to SQL NULL', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW] });

      await gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {
        load_limits: { dumbbell: { max_kg: 22.5, increment_kg: 2.27 } },
      });

      let [text, params] = mockClient.query.mock.calls[0];
      expect(text).toContain('load_limits = $3::jsonb');
      expect(params[2]).toBe(
        JSON.stringify({ dumbbell: { max_kg: 22.5, increment_kg: 2.27 } })
      );

      mockClient.query.mockClear();
      mockClient.query.mockResolvedValue({ rows: [ROW] });
      await gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {
        load_limits: null,
      });
      [text, params] = mockClient.query.mock.calls[0];
      expect(text).toContain('load_limits = $3::jsonb');
      expect(params[2]).toBeNull();
    });

    it('returns null when the row does not belong to the user', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await gymEquipmentProfileRepository.updateGymProfile(
        'user-1',
        ROW.id,
        { name: 'Garage' }
      );

      expect(result).toBeNull();
    });

    it('refuses an empty patch instead of writing nothing silently', async () => {
      await expect(
        gymEquipmentProfileRepository.updateGymProfile('user-1', ROW.id, {})
      ).rejects.toThrow('empty patch');
      expect(mockClient.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteGymProfile', () => {
    it('reports whether a row was removed', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
      await expect(
        gymEquipmentProfileRepository.deleteGymProfile('user-1', ROW.id)
      ).resolves.toBe(true);

      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
      await expect(
        gymEquipmentProfileRepository.deleteGymProfile('user-1', ROW.id)
      ).resolves.toBe(false);
    });
  });

  describe('setActiveGymProfile', () => {
    it('deactivates the previous profile before activating the target', async () => {
      mockClient.query.mockImplementation((text: string) =>
        text.includes('SET is_active = TRUE')
          ? Promise.resolve({ rows: [ROW], rowCount: 1 })
          : Promise.resolve({ rows: [], rowCount: 1 })
      );

      const result = await gymEquipmentProfileRepository.setActiveGymProfile(
        'user-1',
        ROW.id
      );

      const texts = queryTexts();
      expect(texts[0]).toBe('BEGIN');
      const clearIndex = texts.findIndex((text) =>
        text.includes('SET is_active = FALSE')
      );
      const setIndex = texts.findIndex((text) =>
        text.includes('SET is_active = TRUE')
      );
      expect(clearIndex).toBeLessThan(setIndex);
      expect(texts[texts.length - 1]).toBe('COMMIT');
      expect(result).toEqual(ROW);
    });

    it('rolls back and returns null for a profile the user does not own', async () => {
      mockClient.query.mockImplementation((text: string) =>
        text.includes('SET is_active = TRUE')
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : Promise.resolve({ rows: [], rowCount: 0 })
      );

      const result = await gymEquipmentProfileRepository.setActiveGymProfile(
        'user-1',
        ROW.id
      );

      expect(result).toBeNull();
      expect(queryTexts()).toContain('ROLLBACK');
      expect(queryTexts()).not.toContain('COMMIT');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('serialization of activity-changing writes', () => {
    /**
     * Without a lock, two concurrent activations of DIFFERENT profiles both
     * clear the one currently-active row from their own pre-commit snapshot,
     * then each activate their target. Neither sees the other's new active
     * row, both commit, and the partial unique index turns a user's double-tap
     * into a 500. The lock must be taken BEFORE the first write in the
     * transaction, or the same interleaving is still reachable.
     */
    const lockCall = (): [string, unknown[]] | undefined =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockClient.query.mock.calls.find((call: any[]) =>
        String(call[0]).includes('pg_advisory_xact_lock')
      ) as [string, unknown[]] | undefined;

    it('locks the user before flipping the active profile', async () => {
      mockClient.query.mockImplementation((text: string) =>
        text.includes('SET is_active = TRUE')
          ? Promise.resolve({ rows: [ROW], rowCount: 1 })
          : Promise.resolve({ rows: [], rowCount: 1 })
      );

      await gymEquipmentProfileRepository.setActiveGymProfile('user-1', ROW.id);

      const texts = queryTexts();
      const lockIndex = texts.findIndex((text) =>
        text.includes('pg_advisory_xact_lock')
      );
      expect(texts[0]).toBe('BEGIN');
      expect(lockIndex).toBe(1);
      expect(lockIndex).toBeLessThan(
        texts.findIndex((text) => text.includes('SET is_active = FALSE'))
      );
      // Namespaced and per-user: the key must not collide with another
      // feature's advisory lock, and must not serialize unrelated users.
      expect(lockCall()?.[1]).toEqual(['gym_equipment_profiles:user-1']);
    });

    it('locks the user when creating a profile that starts active', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW], rowCount: 1 });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Home',
        equipment: ['dumbbell'],
        is_active: true,
      });

      const texts = queryTexts();
      expect(texts[1]).toContain('pg_advisory_xact_lock');
      expect(lockCall()?.[1]).toEqual(['gym_equipment_profiles:user-1']);
    });

    it('does not lock when creating an inactive profile', async () => {
      mockClient.query.mockResolvedValue({ rows: [ROW], rowCount: 1 });

      await gymEquipmentProfileRepository.createGymProfile('user-1', {
        name: 'Gym',
        equipment: ['barbell'],
      });

      // An inactive insert cannot contend for the one active slot, so it must
      // not queue behind an unrelated activation.
      expect(lockCall()).toBeUndefined();
    });
  });
});
