import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import exerciseService from '../services/exerciseService.js';
import gymEquipmentProfileRepository from '../models/gymEquipmentProfileRepository.js';
import exerciseRoutes from '../routes/exerciseRoutes.js';

vi.mock('../middleware/authMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
}));

vi.mock('../services/exerciseService.js', () => ({
  default: {
    searchExercises: vi.fn(),
  },
}));

vi.mock('../models/gymEquipmentProfileRepository.js', () => ({
  default: {
    getActiveGymProfile: vi.fn(),
  },
}));

vi.mock('../models/reportRepository.js', () => ({ default: {} }));
vi.mock('../integrations/wger/wgerService.js', () => ({ default: {} }));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const app = express();
app.use('/exercises', exerciseRoutes);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service = exerciseService as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const repo = gymEquipmentProfileRepository as any;

/** The browse-filter equipment array the route handed to the search. */
function equipmentFilterArg(): string[] {
  return service.searchExercises.mock.calls[0][3];
}

/**
 * The gym-profile availability set. Null means no profile is in play; an empty
 * array means an active profile that lists no equipment — a real, different
 * state, which is why this is a separate argument rather than an overloaded
 * `equipmentFilter`.
 */
function availableEquipmentArg(): string[] | null {
  return service.searchExercises.mock.calls[0][5];
}

describe('GET /exercises/search — useActiveGymProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.searchExercises.mockResolvedValue([]);
  });

  it('is inert for existing callers that omit the flag', async () => {
    const res = await request(app).get('/exercises/search?searchTerm=press');

    expect(res.statusCode).toBe(200);
    expect(repo.getActiveGymProfile).not.toHaveBeenCalled();
    expect(equipmentFilterArg()).toEqual([]);
    expect(availableEquipmentArg()).toBeNull();
  });

  it('still honours an explicit equipmentFilter on its own', async () => {
    const res = await request(app).get(
      '/exercises/search?searchTerm=press&equipmentFilter=dumbbell,cable'
    );

    expect(res.statusCode).toBe(200);
    expect(equipmentFilterArg()).toEqual(['dumbbell', 'cable']);
    expect(availableEquipmentArg()).toBeNull();
  });

  it("unions the active profile's equipment with the always-available set", async () => {
    repo.getActiveGymProfile.mockResolvedValue({
      id: 'profile-1',
      equipment: ['dumbbell', 'bands'],
    });

    const res = await request(app).get(
      '/exercises/search?searchTerm=press&useActiveGymProfile=true'
    );

    expect(res.statusCode).toBe(200);
    // Bodyweight work is doable anywhere, so it survives every profile. The
    // profile set travels as availability, not as a browse filter.
    expect(availableEquipmentArg()!.sort()).toEqual([
      'bands',
      'body only',
      'dumbbell',
    ]);
    expect(equipmentFilterArg()).toEqual([]);
  });

  it("does not smuggle in 'other', which is a grab-bag of real gear", async () => {
    repo.getActiveGymProfile.mockResolvedValue({
      id: 'profile-1',
      equipment: ['dumbbell', 'bands'],
    });

    await request(app).get(
      '/exercises/search?searchTerm=press&useActiveGymProfile=true'
    );

    // free-exercise-db files Atlas Stones, Car Deadlift and Battling Ropes
    // under 'other'; auto-admitting it would offer a home lifter a car
    // deadlift. A user who owns that gear lists it on the profile.
    expect(availableEquipmentArg()).not.toContain('other');
  });

  it('does not duplicate equipment the profile already lists', async () => {
    repo.getActiveGymProfile.mockResolvedValue({
      id: 'profile-1',
      equipment: ['body only', 'barbell'],
    });

    await request(app).get(
      '/exercises/search?searchTerm=press&useActiveGymProfile=true'
    );

    const available = availableEquipmentArg()!;
    expect(available).toEqual([...new Set(available)]);
    expect(available.sort()).toEqual(['barbell', 'body only']);
  });

  it('passes an empty availability set for a profile that lists no equipment', async () => {
    repo.getActiveGymProfile.mockResolvedValue({
      id: 'profile-1',
      equipment: [],
    });

    await request(app).get(
      '/exercises/search?searchTerm=press&useActiveGymProfile=true'
    );

    // "I own nothing" is a real answer and must not collapse to "no filter":
    // it leaves the equipment-free exercises, not the whole catalog.
    expect(availableEquipmentArg()).toEqual(['body only']);
  });

  it('stays broad when the user has no active profile', async () => {
    repo.getActiveGymProfile.mockResolvedValue(null);

    const res = await request(app).get(
      '/exercises/search?searchTerm=press&useActiveGymProfile=true'
    );

    // No profile means no constraint — not an empty result set.
    expect(res.statusCode).toBe(200);
    expect(equipmentFilterArg()).toEqual([]);
    expect(availableEquipmentArg()).toBeNull();
  });

  it('rejects combining the flag with an explicit equipmentFilter', async () => {
    const res = await request(app).get(
      '/exercises/search?searchTerm=press&equipmentFilter=barbell&useActiveGymProfile=true'
    );

    expect(res.statusCode).toBe(400);
    expect(service.searchExercises).not.toHaveBeenCalled();
    expect(repo.getActiveGymProfile).not.toHaveBeenCalled();
  });

  it('ignores any value other than the literal true', async () => {
    await request(app).get(
      '/exercises/search?searchTerm=press&useActiveGymProfile=1'
    );

    expect(repo.getActiveGymProfile).not.toHaveBeenCalled();
  });
});
