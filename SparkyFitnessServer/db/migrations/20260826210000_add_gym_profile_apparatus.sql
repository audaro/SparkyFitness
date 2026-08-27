-- Apparatus the profile's gym actually has (pull-up bar, dip station,
-- squat rack, bench). Vocabulary: the shared EXERCISE_APPARATUS constant
-- (shared/src/constants/exerciseApparatus.ts), NOT the equipment enum —
-- these values must never reach the `equipment ?|` catalog filter.
--
-- Tri-state:
--   NULL  = never stated; the engine keeps inferring apparatus from
--           barbell/cable/machine (the pre-existing behavior).
--   '[]'  = stated: none of these are available (authoritative).
--   array = stated: exactly these are available (authoritative).
ALTER TABLE public.gym_equipment_profiles
    ADD COLUMN IF NOT EXISTS apparatus JSONB NULL;
