import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import gymEquipmentProfileRepository from '../models/gymEquipmentProfileRepository.js';
import gymEquipmentProfileRoutes from '../routes/gymEquipmentProfileRoutes.js';

vi.mock('../models/gymEquipmentProfileRepository.js', () => ({
  default: {
    listGymProfiles: vi.fn(),
    getGymProfile: vi.fn(),
    getActiveGymProfile: vi.fn(),
    createGymProfile: vi.fn(),
    updateGymProfile: vi.fn(),
    deleteGymProfile: vi.fn(),
    setActiveGymProfile: vi.fn(),
  },
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/gym-equipment-profiles', gymEquipmentProfileRoutes);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ROW = {
  id: PROFILE_ID,
  user_id: '22222222-2222-4222-8222-222222222222',
  name: 'Home',
  equipment: ['dumbbell', 'bands'],
  apparatus: null,
  equipment_items: null,
  load_limits: null,
  is_active: true,
  created_at: new Date('2026-08-23T10:00:00.000Z'),
  updated_at: new Date('2026-08-23T11:00:00.000Z'),
};

const repo = gymEquipmentProfileRepository as any;

describe('Gym Equipment Profile Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns the profiles with ISO string timestamps', async () => {
      repo.listGymProfiles.mockResolvedValue([ROW]);

      const res = await request(app).get('/api/gym-equipment-profiles');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        profiles: [
          {
            id: PROFILE_ID,
            user_id: ROW.user_id,
            name: 'Home',
            equipment: ['dumbbell', 'bands'],
            apparatus: null,
            equipment_items: null,
            load_limits: null,
            equipment_preference: null,
            is_active: true,
            created_at: '2026-08-23T10:00:00.000Z',
            updated_at: '2026-08-23T11:00:00.000Z',
          },
        ],
      });
      expect(repo.listGymProfiles).toHaveBeenCalledWith('test-user-id');
    });

    it('returns an empty list rather than 404 when the user has none', async () => {
      repo.listGymProfiles.mockResolvedValue([]);

      const res = await request(app).get('/api/gym-equipment-profiles');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ profiles: [] });
    });
  });

  describe('POST /', () => {
    it('creates a profile from canonical equipment values', async () => {
      repo.createGymProfile.mockResolvedValue(ROW);

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Home', equipment: ['dumbbell', 'bands'] });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe('Home');
      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'Home',
        equipment: ['dumbbell', 'bands'],
      });
    });

    it('forwards is_active so the first profile can be created active', async () => {
      repo.createGymProfile.mockResolvedValue(ROW);

      await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Home', equipment: [], is_active: true });

      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'Home',
        equipment: [],
        is_active: true,
      });
    });

    it('creates a profile with stated apparatus', async () => {
      repo.createGymProfile.mockResolvedValue({
        ...ROW,
        apparatus: ['bench'],
      });

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: ['bench'],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.apparatus).toEqual(['bench']);
      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'Home',
        equipment: ['dumbbell', 'bands'],
        apparatus: ['bench'],
      });
    });

    it('creates a profile with load limits', async () => {
      repo.createGymProfile.mockResolvedValue({
        ...ROW,
        load_limits: { dumbbell: { max_kg: 22.5 } },
      });

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'Home',
          equipment: ['dumbbell'],
          load_limits: { dumbbell: { max_kg: 22.5 } },
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.load_limits).toEqual({ dumbbell: { max_kg: 22.5 } });
      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'Home',
        equipment: ['dumbbell'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
      });
    });

    it('creates a profile with an equipment preference', async () => {
      repo.createGymProfile.mockResolvedValue({
        ...ROW,
        equipment_preference: 'machines',
      });

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'PF',
          equipment: ['machine'],
          equipment_preference: 'machines',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.equipment_preference).toBe('machines');
      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'PF',
        equipment: ['machine'],
        equipment_preference: 'machines',
      });
    });

    it('carries the preference through the item-derivation branch', async () => {
      // That branch rebuilds the create payload field by field instead of
      // spreading it, so a field it forgets is dropped for item-stated
      // profiles only — exactly the shape of bug that survives a spread test.
      repo.createGymProfile.mockResolvedValue({
        ...ROW,
        equipment_preference: 'machines',
      });

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'PF',
          equipment_items: ['chest-press-machine', 'pec-deck'],
          equipment_preference: 'machines',
        });

      expect(res.statusCode).toBe(201);
      expect(repo.createGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        expect.objectContaining({ equipment_preference: 'machines' })
      );
    });

    it('rejects a preference outside the vocabulary', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        // Compared by exact string equality in scoring, so a synonym would
        // read as "never stated" rather than failing.
        .send({
          name: 'PF',
          equipment: ['machine'],
          equipment_preference: 'Machines',
        });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects a load-limit key outside the equipment vocabulary', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        // A `Dumbbell` entry would never match the lowercase equipment value
        // the engine caps against — it would silently limit nothing.
        .send({
          name: 'Home',
          equipment: ['dumbbell'],
          load_limits: { Dumbbell: { max_kg: 22.5 } },
        });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects a non-positive load ceiling', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'Home',
          equipment: ['dumbbell'],
          load_limits: { dumbbell: { max_kg: 0 } },
        });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects an apparatus value outside the vocabulary', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        // An equipment string is not an apparatus; the vocabularies are
        // deliberately separate.
        .send({ name: 'Home', equipment: [], apparatus: ['barbell'] });

      expect(res.statusCode).toBe(400);
      expect(res.body.details.apparatus).toBeDefined();
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects an equipment value outside the canonical vocabulary', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        // Title case matches nothing through `::jsonb ?|`, so it must not
        // be stored as if it were a real filter value.
        .send({ name: 'Home', equipment: ['Dumbbell'] });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Invalid request body');
      expect(res.body.details.equipment).toBeDefined();
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects an unknown equipment string', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Home', equipment: ['smith machine'] });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects a blank name', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: '   ', equipment: [] });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects unknown keys instead of silently dropping them', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Home', equipment: [], gym_id: 7 });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('derives equipment and apparatus when items are stated', async () => {
      repo.createGymProfile.mockResolvedValue({
        ...ROW,
        equipment: ['dumbbell', 'machine'],
        apparatus: ['bench'],
        equipment_items: ['dumbbells', 'smith-machine', 'flat-bench'],
      });

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'PF',
          equipment_items: [
            'dumbbells',
            'smith-machine',
            'flat-bench',
            'dumbbells',
          ],
        });

      expect(res.statusCode).toBe(201);
      // Deduped items, coarse columns derived — the route owns the contract.
      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'PF',
        equipment: ['dumbbell', 'machine'],
        apparatus: ['bench'],
        equipment_items: ['dumbbells', 'smith-machine', 'flat-bench'],
        load_limits: undefined,
        is_active: undefined,
      });
    });

    it('treats stated-but-empty items as an authoritative nothing', async () => {
      repo.createGymProfile.mockResolvedValue({
        ...ROW,
        equipment: [],
        apparatus: [],
        equipment_items: [],
      });

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Bodyweight', equipment_items: [] });

      expect(res.statusCode).toBe(201);
      expect(repo.createGymProfile).toHaveBeenCalledWith('test-user-id', {
        name: 'Bodyweight',
        equipment: [],
        apparatus: [],
        equipment_items: [],
        load_limits: undefined,
        is_active: undefined,
      });
    });

    it('rejects a payload stating both items and coarse equipment', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'Both',
          equipment: ['dumbbell'],
          equipment_items: ['dumbbells'],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.details.equipment_items[0]).toBe(
        'equipment and apparatus are derived from equipment_items; send one or the other, not both'
      );
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects a payload stating both items and apparatus', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({
          name: 'Both',
          apparatus: ['bench'],
          equipment_items: ['dumbbells'],
        });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects a payload with neither equipment nor items', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Nothing stated' });

      expect(res.statusCode).toBe(400);
      expect(res.body.details.equipment[0]).toBe(
        'Provide equipment or equipment_items'
      );
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('rejects an item slug outside the vocabulary', async () => {
      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Typo', equipment_items: ['smith machine'] });

      expect(res.statusCode).toBe(400);
      expect(repo.createGymProfile).not.toHaveBeenCalled();
    });

    it('maps a duplicate name to 409', async () => {
      repo.createGymProfile.mockRejectedValue(
        Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint: 'gym_equipment_profiles_user_id_name_key',
        })
      );

      const res = await request(app)
        .post('/api/gym-equipment-profiles')
        .send({ name: 'Home', equipment: [] });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe(
        'A gym profile with this name already exists.'
      );
    });
  });

  describe('PUT /:id', () => {
    it('updates the supplied fields', async () => {
      repo.updateGymProfile.mockResolvedValue(ROW);

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ name: 'Garage' });

      expect(res.statusCode).toBe(200);
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { name: 'Garage' }
      );
    });

    it('accepts an empty apparatus array as an authoritative "none"', async () => {
      repo.updateGymProfile.mockResolvedValue({ ...ROW, apparatus: [] });

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ apparatus: [] });

      expect(res.statusCode).toBe(200);
      expect(res.body.apparatus).toEqual([]);
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        // A coarse apparatus rewrite drops stored items to coarse mode.
        { apparatus: [], equipment_items: null }
      );
    });

    it('accepts explicit null to clear load limits', async () => {
      repo.updateGymProfile.mockResolvedValue(ROW);

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ load_limits: null });

      expect(res.statusCode).toBe(200);
      expect(res.body.load_limits).toBeNull();
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { load_limits: null }
      );
    });

    it('clears the equipment preference back to unstated', async () => {
      repo.updateGymProfile.mockResolvedValue({
        ...ROW,
        equipment_preference: null,
      });

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ equipment_preference: null });

      expect(res.statusCode).toBe(200);
      expect(res.body.equipment_preference).toBeNull();
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { equipment_preference: null }
      );
    });

    it('accepts explicit null to clear apparatus back to "never stated"', async () => {
      repo.updateGymProfile.mockResolvedValue(ROW);

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ apparatus: null });

      expect(res.statusCode).toBe(200);
      expect(res.body.apparatus).toBeNull();
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { apparatus: null, equipment_items: null }
      );
    });

    it('re-derives the coarse columns when a patch states items', async () => {
      repo.updateGymProfile.mockResolvedValue({
        ...ROW,
        equipment: ['cable'],
        apparatus: [],
        equipment_items: ['cable-tower'],
      });

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ equipment_items: ['cable-tower', 'cable-tower'] });

      expect(res.statusCode).toBe(200);
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        {
          equipment_items: ['cable-tower'],
          equipment: ['cable'],
          apparatus: [],
        }
      );
    });

    it('accepts explicit null to drop the profile back to coarse mode', async () => {
      repo.updateGymProfile.mockResolvedValue(ROW);

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ equipment_items: null });

      expect(res.statusCode).toBe(200);
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { equipment_items: null }
      );
    });

    it('drops stored items when a patch rewrites coarse equipment', async () => {
      repo.updateGymProfile.mockResolvedValue(ROW);

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ equipment: ['dumbbell'] });

      expect(res.statusCode).toBe(200);
      // The route adds equipment_items: null so stored items cannot drift
      // out of agreement with the edited coarse columns.
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { equipment: ['dumbbell'], equipment_items: null }
      );
    });

    it('leaves stored items alone for a rename-only patch', async () => {
      repo.updateGymProfile.mockResolvedValue({ ...ROW, name: 'Renamed' });

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ name: 'Renamed' });

      expect(res.statusCode).toBe(200);
      expect(repo.updateGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID,
        { name: 'Renamed' }
      );
    });

    it('rejects a patch stating both items and coarse equipment', async () => {
      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ equipment: ['dumbbell'], equipment_items: ['dumbbells'] });

      expect(res.statusCode).toBe(400);
      expect(repo.updateGymProfile).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid id', async () => {
      const res = await request(app)
        .put('/api/gym-equipment-profiles/not-a-uuid')
        .send({ name: 'Garage' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Invalid profile id');
      expect(repo.updateGymProfile).not.toHaveBeenCalled();
    });

    it('rejects an empty patch', async () => {
      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({});

      expect(res.statusCode).toBe(400);
      expect(repo.updateGymProfile).not.toHaveBeenCalled();
    });

    it('refuses is_active here — activation is its own endpoint', async () => {
      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ is_active: true });

      expect(res.statusCode).toBe(400);
      expect(repo.updateGymProfile).not.toHaveBeenCalled();
    });

    it('404s for a profile the user does not own', async () => {
      repo.updateGymProfile.mockResolvedValue(null);

      const res = await request(app)
        .put(`/api/gym-equipment-profiles/${PROFILE_ID}`)
        .send({ name: 'Garage' });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes an owned profile', async () => {
      repo.deleteGymProfile.mockResolvedValue(true);

      const res = await request(app).delete(
        `/api/gym-equipment-profiles/${PROFILE_ID}`
      );

      expect(res.statusCode).toBe(200);
      expect(repo.deleteGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID
      );
    });

    it('404s when nothing was deleted', async () => {
      repo.deleteGymProfile.mockResolvedValue(false);

      const res = await request(app).delete(
        `/api/gym-equipment-profiles/${PROFILE_ID}`
      );

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /:id/activate', () => {
    it('activates the profile', async () => {
      repo.setActiveGymProfile.mockResolvedValue(ROW);

      const res = await request(app).post(
        `/api/gym-equipment-profiles/${PROFILE_ID}/activate`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.is_active).toBe(true);
      expect(repo.setActiveGymProfile).toHaveBeenCalledWith(
        'test-user-id',
        PROFILE_ID
      );
    });

    it('404s for a profile the user does not own', async () => {
      repo.setActiveGymProfile.mockResolvedValue(null);

      const res = await request(app).post(
        `/api/gym-equipment-profiles/${PROFILE_ID}/activate`
      );

      expect(res.statusCode).toBe(404);
    });

    it('rejects a non-uuid id', async () => {
      const res = await request(app).post(
        '/api/gym-equipment-profiles/not-a-uuid/activate'
      );

      expect(res.statusCode).toBe(400);
      expect(repo.setActiveGymProfile).not.toHaveBeenCalled();
    });
  });
});
