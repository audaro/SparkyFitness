-- Per-profile load ceilings and increments, kg, keyed by canonical
-- equipment value: {"dumbbell": {"max_kg": 22.68, "increment_kg": 2.27}}.
-- Dumbbell numbers are per-hand, matching how set weights are logged.
--
-- NULL = no limits stated; prescription uses the global
-- EQUIPMENT_INCREMENT_KG table and no ceiling (the pre-existing behavior).
-- Validation of keys and shapes happens at the API boundary against the
-- shared loadLimitsSchema.
ALTER TABLE public.gym_equipment_profiles
    ADD COLUMN IF NOT EXISTS load_limits JSONB NULL;
