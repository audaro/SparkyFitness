-- Experience level: the user's self-stated training experience
-- ('beginner' | 'intermediate' | 'expert' — the exercises.level vocabulary,
-- because the workout generator matches candidate levels against it exactly;
-- any other spelling would silently match nothing).
--
-- Nullable with no default: "not stated" is a real answer, under which the
-- generation engine behaves exactly as before this column existed, so
-- existing rows need no backfill. Vocabulary is enforced by Zod at every
-- write path (REST PATCH schema, chat tool schema), like the bounds on
-- training_days_per_week.
ALTER TABLE public.coach_profiles
    ADD COLUMN IF NOT EXISTS experience_level TEXT;

-- RLS is unchanged: coach_profiles already carries an owner policy covering
-- every column (rls_policies.sql), and grants are table-level.
