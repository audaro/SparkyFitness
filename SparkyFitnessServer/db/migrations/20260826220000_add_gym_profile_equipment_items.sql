-- Granular equipment items the profile's gym contains, as kebab-case slugs
-- from the shared EQUIPMENT_ITEMS vocabulary
-- (shared/src/constants/equipmentItems.ts): ["smith-machine","dumbbells",...].
-- These slugs must never reach the `equipment ?|` catalog filter — the
-- coarse `equipment` column stays the search vocabulary.
--
-- Tri-state:
--   NULL  = never stated (legacy profile); every reader behaves exactly as
--           before this column existed.
--   array = stated: exactly these items ('[]' = an authoritative "nothing").
--
-- Derivation contract: when a write states items, the server derives the
-- `equipment` and `apparatus` columns from them and writes all three, so the
-- coarse columns always agree with the items and legacy readers keep
-- working unmodified. A payload stating both items and coarse fields is
-- rejected at the API boundary.
ALTER TABLE public.gym_equipment_profiles
    ADD COLUMN IF NOT EXISTS equipment_items JSONB NULL;
