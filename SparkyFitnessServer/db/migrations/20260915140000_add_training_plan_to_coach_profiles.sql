-- Training plan: the structured answers behind the plan questionnaire, which
-- gives a form to the coaching context that until now only the AI chat could
-- write.
--
-- Every column is nullable with no default, and null means "not answered" in
-- each case. That is what lets existing rows stay untouched: with all five
-- null, weekly set targets and workout generation behave exactly as they did
-- before this migration, and the questionnaire's absence is not an error state.
--
-- Vocabularies are enforced by Zod at every write path (the REST PATCH schema
-- and the chat tool schema) rather than by CHECK constraints, matching how
-- experience_level and the training_days_per_week bounds already work here. A
-- database constraint would reject the write with an error no client could
-- render, and would need its own migration to extend.
ALTER TABLE public.coach_profiles
    -- What the user trains for: 'build_muscle' | 'lose_fat' | 'recomp' |
    -- 'strength' | 'general_fitness'. Replaces reading intent out of the
    -- free-text goals column with a regex; goals survives as the "anything
    -- else" note, and generation falls back to it while this is null so
    -- chat-only profiles keep working unchanged.
    ADD COLUMN IF NOT EXISTS primary_goal TEXT,

    -- The shape trained toward: 'lean' | 'athletic' | 'muscular' | 'powerful'
    -- | 'maintain'. Biases the push/pull/legs ratio and the core allowance.
    ADD COLUMN IF NOT EXISTS physique_target TEXT,

    -- Up to two MuscleGroup values ('push' | 'pull' | 'legs' | 'core') that
    -- take extra weekly volume. A jsonb array rather than a text[] to match
    -- every other list column on this table, so the repository's single
    -- jsonb-serialization rule keeps covering all of them.
    ADD COLUMN IF NOT EXISTS priority_muscle_groups JSONB,

    -- { status, testosterone_mg_per_dose?, dose_interval_weeks?, ester? }
    -- behind the lean-mass projection. The dose is stored as stated rather
    -- than as a weekly average, so a 10-weekly protocol reads back as what
    -- the user typed; the weekly figure is derived where it is needed.
    --
    -- SENSITIVE. This column must never reach the chat model: the chat
    -- provider is third-party, and neither the tool renderer nor the cached
    -- system-prompt summary may include it. Both build their text field by
    -- field rather than spreading the row, and tests assert this column's
    -- absence from both.
    ADD COLUMN IF NOT EXISTS enhancement JSONB,

    -- When the questionnaire was last completed. Null is what makes the
    -- Exercise home offer to set a plan up; it is not derivable from the other
    -- four, because answering one question in isolation is not a finished plan.
    ADD COLUMN IF NOT EXISTS plan_completed_at TIMESTAMPTZ;

-- RLS is unchanged: coach_profiles already carries an owner policy covering
-- every column (rls_policies.sql), and grants are table-level. The table stays
-- Tier 1 / owner-only, which is what keeps the enhancement column out of every
-- family-sharing path by construction rather than by a filter someone has to
-- remember.
