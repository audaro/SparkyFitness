-- Create coach_profiles table
-- Persistent AI-coach context for a user: goals, training constraints,
-- equipment, limitations, food preferences, and personal aliases
-- ("my usual walk" → a concrete exercise/meal id). One row per user.
CREATE TABLE IF NOT EXISTS public.coach_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public."user"(id) ON DELETE CASCADE,
    goals TEXT,
    training_days_per_week INTEGER,
    session_minutes INTEGER,
    equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations JSONB NOT NULL DEFAULT '[]'::jsonb,   -- injuries/constraints, freeform strings
    food_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    aliases JSONB NOT NULL DEFAULT '{}'::jsonb,       -- "my usual walk" → {kind:'exercise', id:...}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_profiles_user_id ON public.coach_profiles(user_id);

-- RLS Policies are enabled and defined in rls_policies.sql
-- Permissions are granted in grantPermissions.ts
