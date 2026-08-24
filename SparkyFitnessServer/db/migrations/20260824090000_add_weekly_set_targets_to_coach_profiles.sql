-- Weekly set targets: how many working sets per training group the user means
-- to perform in a week (e.g. {"push": 14, "pull": 14, "legs": 14, "core": 6}).
--
-- Stored on coach_profiles rather than in a table of its own because it is one
-- small value per user that belongs with the other training intent already
-- kept here (training_days_per_week, session_minutes), and because a JSONB map
-- survives the group vocabulary changing without another migration.
--
-- An empty object means "not set" and the server derives a default from
-- training_days_per_week, so existing rows need no backfill.
ALTER TABLE public.coach_profiles
    ADD COLUMN IF NOT EXISTS weekly_set_targets JSONB NOT NULL DEFAULT '{}'::jsonb;

-- RLS is unchanged: coach_profiles already carries an owner policy covering
-- every column (rls_policies.sql), and grants are table-level.
