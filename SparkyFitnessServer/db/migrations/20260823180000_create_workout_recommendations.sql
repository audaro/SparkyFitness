-- Create workout_recommendations table
-- The generated "Up Next" workout: one standing recommendation per user,
-- produced by the deterministic engine in services/workoutRecommendationService.ts
-- and consumed by the mobile Up Next surface.
--
-- Why persist it at all, when the generator is deterministic and could run on
-- every request: the workout has to stay put. A user who opens the app, sees
-- "Chest & Triceps, 5 exercises", closes it and comes back must find the same
-- workout waiting. Regeneration is an explicit act (first open, or Swap), not
-- a side effect of looking at the screen -- and once they start logging, the
-- freshness scores that produced it have already moved.
CREATE TABLE IF NOT EXISTS public.workout_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- UNIQUE, not just a FK: exactly one standing recommendation per user, so
    -- writes are an upsert (ON CONFLICT (user_id) DO UPDATE) and there is no
    -- way to accumulate stale rows. Same shape as coach_profiles.
    user_id UUID NOT NULL UNIQUE REFERENCES public."user"(id) ON DELETE CASCADE,
    -- Which gym the workout was built for. SET NULL rather than CASCADE: if
    -- the profile is deleted the recommendation is stale, not meaningless, and
    -- deleting a gym profile should not silently delete the user's workout.
    gym_profile_id UUID REFERENCES public.gym_equipment_profiles(id) ON DELETE SET NULL,
    target_duration_minutes INTEGER NOT NULL,
    -- WorkoutRecommendationPayload (shared/src/schemas/api/WorkoutRecommendations.api.zod.ts):
    -- the exercises with their programmed sets. Metric throughout -- weight in
    -- kg, duration and rest in whole seconds, distance in km -- like every
    -- other stored workout value; clients convert for display only.
    payload JSONB NOT NULL,
    -- Lifecycle, so a client can tell a fresh suggestion from one already
    -- acted on. Nothing server-side branches on this yet; it exists so the
    -- surfaces know when to offer regeneration.
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'started', 'completed', 'dismissed')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS Policies are enabled and defined in rls_policies.sql
-- Permissions are granted in grantPermissions.ts
