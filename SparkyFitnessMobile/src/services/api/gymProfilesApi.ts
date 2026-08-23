import type {
  CreateGymEquipmentProfileRequest,
  GymEquipmentProfileResponse,
  GymEquipmentProfilesListResponse,
  UpdateGymEquipmentProfileRequest,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

// Payload shapes are the shared request schemas the server validates against;
// these aliases keep the mobile-local names the screens were written against.
export type GymProfile = GymEquipmentProfileResponse;
export type GymProfileCreatePayload = CreateGymEquipmentProfileRequest;
export type GymProfileUpdatePayload = UpdateGymEquipmentProfileRequest;

const SERVICE_NAME = 'Gym Profiles API';

export const fetchGymProfiles = async (): Promise<GymProfile[]> => {
  const response = await apiFetch<GymEquipmentProfilesListResponse>({
    endpoint: '/api/gym-equipment-profiles',
    serviceName: SERVICE_NAME,
    operation: 'fetch gym profiles',
  });
  return response.profiles;
};

export const createGymProfile = async (
  body: GymProfileCreatePayload,
): Promise<GymProfile> => {
  return apiFetch<GymProfile>({
    endpoint: '/api/gym-equipment-profiles',
    method: 'POST',
    body,
    serviceName: SERVICE_NAME,
    operation: 'create gym profile',
  });
};

export const updateGymProfile = async (
  id: string,
  body: GymProfileUpdatePayload,
): Promise<GymProfile> => {
  return apiFetch<GymProfile>({
    endpoint: `/api/gym-equipment-profiles/${id}`,
    method: 'PUT',
    body,
    serviceName: SERVICE_NAME,
    operation: 'update gym profile',
  });
};

export const deleteGymProfile = async (id: string): Promise<{ message: string }> => {
  return apiFetch<{ message: string }>({
    endpoint: `/api/gym-equipment-profiles/${id}`,
    method: 'DELETE',
    serviceName: SERVICE_NAME,
    operation: 'delete gym profile',
  });
};

/**
 * Activating is a server-side transaction (the previous active profile is
 * cleared in the same statement pair), so there is no client-side "deactivate
 * the other one" step.
 */
export const activateGymProfile = async (id: string): Promise<GymProfile> => {
  return apiFetch<GymProfile>({
    endpoint: `/api/gym-equipment-profiles/${id}/activate`,
    method: 'POST',
    serviceName: SERVICE_NAME,
    operation: 'activate gym profile',
  });
};
