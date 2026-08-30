/**
 * The one gym equipment profile the suggested-workout scenario switches to, and
 * the single definition both ends of it read — the seeder creates it by this
 * name, the oracle finds the row by it.
 *
 * See qa/bin/qa-gym-profile.mjs for why it is seeded inactive and why its
 * equipment list is deliberately irrelevant to what gets prescribed.
 */
export const QA_GYM_PROFILE = {
  name: 'QA Gym',
  /**
   * Something, but nothing the catalog uses. Every seeded exercise is
   * `body only` — ALWAYS_AVAILABLE_EQUIPMENT, performable under any profile —
   * so this list changes no exercise's eligibility. It is a plausible value
   * rather than an empty array only because a gym that stocks literally nothing
   * is a shape the app's own forms cannot produce, and fixtures that drift from
   * what the product can make stop being evidence about the product.
   */
  equipment: ['dumbbell'],
};
