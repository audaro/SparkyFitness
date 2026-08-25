import { apiCall } from '@/api/api';
import type {
  CreateGymEquipmentProfileRequest,
  GymEquipmentProfileResponse,
  GymEquipmentProfilesListResponse,
  UpdateGymEquipmentProfileRequest,
} from '@workspace/shared';

export type GymProfile = GymEquipmentProfileResponse;
export type GymProfileCreatePayload = CreateGymEquipmentProfileRequest;
export type GymProfileUpdatePayload = UpdateGymEquipmentProfileRequest;

// The server returns the active profile first; callers render in that order.
export const getGymProfiles = async (): Promise<GymProfile[]> => {
  const response: GymEquipmentProfilesListResponse = await apiCall(
    '/gym-equipment-profiles',
    { method: 'GET' }
  );
  return response.profiles;
};

export const createGymProfile = async (
  payload: GymProfileCreatePayload
): Promise<GymProfile> => {
  return apiCall('/gym-equipment-profiles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

// `is_active` is deliberately not part of the update payload: activation is a
// cross-row transaction that would trip the one-active partial unique index if
// a plain UPDATE tried to set it. Use activateGymProfile instead.
export const updateGymProfile = async (
  id: string,
  payload: GymProfileUpdatePayload
): Promise<GymProfile> => {
  return apiCall(`/gym-equipment-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
};

export const deleteGymProfile = async (
  id: string
): Promise<{ message: string }> => {
  return apiCall(`/gym-equipment-profiles/${id}`, {
    method: 'DELETE',
  });
};

export const activateGymProfile = async (id: string): Promise<GymProfile> => {
  return apiCall(`/gym-equipment-profiles/${id}/activate`, {
    method: 'POST',
  });
};
