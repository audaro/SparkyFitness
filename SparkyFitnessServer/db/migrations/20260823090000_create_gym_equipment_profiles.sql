-- Create gym_equipment_profiles table
-- Named, switchable equipment sets ("Home", "Planet Fitness") the user picks
-- between. The active profile constrains workout generation and, opt-in, the
-- exercise catalog search, so the app only ever programs movements the user
-- can actually perform where they are today.
--
-- Distinct from coach_profiles.equipment, which stays the free-form
-- conversational intake field the AI coach writes; these rows are the
-- structured product feature.
CREATE TABLE IF NOT EXISTS public.gym_equipment_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Elements are canonical free-exercise-db equipment strings (the shared
    -- EQUIPMENT constant in shared/src/constants/exerciseTaxonomy.ts). The
    -- catalog matches them with `equipment::jsonb ?|`, an exact
    -- case-sensitive comparison, so anything else silently matches nothing.
    equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_gym_equipment_profiles_user_id ON public.gym_equipment_profiles(user_id);

-- At most one active profile per user. A partial unique index, so the many
-- inactive rows do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_equipment_profiles_one_active
    ON public.gym_equipment_profiles(user_id) WHERE is_active;

-- RLS Policies are enabled and defined in rls_policies.sql
-- Permissions are granted in grantPermissions.ts
