import { describe, it, expect } from 'vitest';
import {
  ON_DEMAND_WORKOUTS,
  generateWorkoutRecommendationRequestSchema,
  isKnownMuscle,
  onDemandGenerateRequest,
} from '@workspace/shared';

// The themes are request bodies with names on them, and nothing type-checks a
// duration against the wire's 15..180 bound or stops an empty muscle array from
// reaching a `.min(1)` field. Either mistake ships as a 400 the user meets by
// tapping a row that looks fine, so the schema itself is the assertion.
describe('on-demand workout themes', () => {
  it('sends a body the generate endpoint accepts', () => {
    for (const theme of ON_DEMAND_WORKOUTS) {
      const parsed = generateWorkoutRecommendationRequestSchema.safeParse(
        onDemandGenerateRequest(theme)
      );
      expect(parsed.success, `${theme.id}: ${parsed.error?.message}`).toBe(
        true
      );
    }
  });

  // "Whatever is freshest" is the absence of a constraint, not a list of all
  // seventeen — the first tracks recovery, the second overrides it. An empty
  // array would be neither: it is a 400.
  it('omits the muscle constraint rather than sending an empty list', () => {
    for (const theme of ON_DEMAND_WORKOUTS) {
      expect(theme.target_muscles?.length ?? 1).toBeGreaterThan(0);
      const body = onDemandGenerateRequest(theme);
      expect('target_muscles' in body).toBe(theme.target_muscles !== undefined);
    }
  });

  // Catalog muscle matching is `::jsonb ?|` — exact and case-sensitive — so a
  // typo is not an error, it is a filter that quietly matches nothing.
  it('names canonical muscles only, without repeats', () => {
    for (const theme of ON_DEMAND_WORKOUTS) {
      const muscles = theme.target_muscles ?? [];
      for (const muscle of muscles) {
        expect(isKnownMuscle(muscle), `${theme.id}: ${muscle}`).toBe(true);
      }
      expect(new Set(muscles).size).toBe(muscles.length);
    }
  });

  it('keys every theme uniquely', () => {
    const ids = ON_DEMAND_WORKOUTS.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  // The body is handed to an API client and may be serialized, logged or
  // adjusted downstream; aliasing the shared constant would put a module-level
  // readonly array on that path, where one mutation corrupts every later theme.
  it('copies the request muscles instead of aliasing the constant', () => {
    const theme = ON_DEMAND_WORKOUTS.find((entry) => entry.target_muscles);
    expect(theme).toBeDefined();
    const body = onDemandGenerateRequest(theme!);
    expect(body.target_muscles).toEqual([...theme!.target_muscles!]);
    expect(body.target_muscles).not.toBe(theme!.target_muscles);
  });
});
