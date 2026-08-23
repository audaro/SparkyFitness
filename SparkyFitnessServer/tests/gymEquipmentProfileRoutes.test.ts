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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/gym-equipment-profiles', gymEquipmentProfileRoutes);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ROW = {
  id: PROFILE_ID,
  user_id: '22222222-2222-4222-8222-222222222222',
  name: 'Home',
  equipment: ['dumbbell', 'bands'],
  is_active: true,
  created_at: new Date('2026-08-23T10:00:00.000Z'),
  updated_at: new Date('2026-08-23T11:00:00.000Z'),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
