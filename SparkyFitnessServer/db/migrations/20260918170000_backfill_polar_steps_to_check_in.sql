-- Backfill Polar daily steps into check_in_measurements (issue #2471).
--
-- processPolarActivity used to write steps as a generic custom measurement under
-- a "Steps" custom category, so they never reached check_in_measurements.steps --
-- the only source Reports -> Daily Steps, the Daily Step Log and the Diary energy
-- goal read from. The processor now calls upsertStepData; this moves the history
-- that was already synced under the old behaviour.
--
-- Non-destructive: the custom_measurements rows are left in place so anyone
-- charting the "Steps" custom category keeps their series.
--
-- custom_measurements.value is text, so the numeric cast is guarded by a regex --
-- an unguarded cast would abort the whole migration on one stray row. The digit
-- count is bounded in the pattern itself rather than by a comparison on the cast
-- value: Postgres does not guarantee WHERE clauses short-circuit left to right,
-- so `value::bigint <= 2147483647` can be evaluated before the pattern test and
-- raise "out of range" on a long digit string. Nine digits caps the value at
-- 999,999,999, safely inside int4.
--
-- Each statement stands alone (no temp table): the migration runner executes the
-- file as a single simple query and does not open an explicit transaction.

-- Days that already have a check-in row: raise steps, never lower them.
UPDATE public.check_in_measurements cim
SET steps = GREATEST(psb.steps, COALESCE(cim.steps, 0)),
    updated_at = now()
FROM (
    SELECT cm.user_id, cm.entry_date, MAX(cm.value::integer) AS steps
    FROM public.custom_measurements cm
    JOIN public.custom_categories cc ON cc.id = cm.category_id
    WHERE cm.source = 'Polar'
      AND cc.name = 'Steps'
      AND cm.value ~ '^[0-9]{1,9}$'
    GROUP BY cm.user_id, cm.entry_date
) psb
WHERE cim.user_id = psb.user_id
  AND cim.entry_date = psb.entry_date
  AND (cim.steps IS NULL OR cim.steps < psb.steps);

-- Days with no check-in row yet.
INSERT INTO public.check_in_measurements
    (user_id, entry_date, steps, created_by_user_id, updated_by_user_id, created_at, updated_at)
SELECT psb.user_id, psb.entry_date, psb.steps, psb.user_id, psb.user_id, now(), now()
FROM (
    SELECT cm.user_id, cm.entry_date, MAX(cm.value::integer) AS steps
    FROM public.custom_measurements cm
    JOIN public.custom_categories cc ON cc.id = cm.category_id
    WHERE cm.source = 'Polar'
      AND cc.name = 'Steps'
      AND cm.value ~ '^[0-9]{1,9}$'
    GROUP BY cm.user_id, cm.entry_date
) psb
ON CONFLICT (user_id, entry_date) DO NOTHING;
