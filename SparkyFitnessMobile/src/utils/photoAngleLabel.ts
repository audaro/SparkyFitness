import type { TFunction } from 'i18next';
import type { PhotoType } from '../types/checkInPhotos';

/**
 * The localized name of a progress-photo angle.
 *
 * Lives here rather than in a screen because the slot grid and the guided
 * capture screen both label the same three angles, and two copies of the switch
 * drift into two different wordings for the same photo.
 */
export const getPhotoAngleLabel = (type: PhotoType, t: TFunction): string => {
  switch (type) {
    case 'front':
      return t('progressPhotos.angle.front', { defaultValue: 'Front' });
    case 'back':
      return t('progressPhotos.angle.back', { defaultValue: 'Back' });
    case 'side':
      return t('progressPhotos.angle.side', { defaultValue: 'Side' });
  }
};
