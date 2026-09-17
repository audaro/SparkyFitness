/**
 * Measurement names the dedicated Respiration card owns.
 *
 * Kept out of RespirationCard.tsx so that file only exports a component:
 * mixing a constant export in breaks Fast Refresh for the whole module.
 */
export const RESPIRATION_METRICS = [
  'Average Respiration Rate',
  'Sleep Respiration Avg',
  'Awake Respiration Avg',
];
