-- 1. Add schedule_type and entry_mode to workout_plan_templates
-- Existing rows automatically receive 'weekly' and 'prefill' via initial DEFAULT
ALTER TABLE workout_plan_templates 
  ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS entry_mode VARCHAR(20) NOT NULL DEFAULT 'prefill';

-- Set default for newly created plans to 'sequential' and 'prompt'
ALTER TABLE workout_plan_templates 
  ALTER COLUMN schedule_type SET DEFAULT 'sequential',
  ALTER COLUMN entry_mode SET DEFAULT 'prompt';

-- 2. Add session_index and session_name to workout_plan_template_assignments for multi-exercise sessions
ALTER TABLE workout_plan_template_assignments 
  ADD COLUMN IF NOT EXISTS session_index INTEGER,
  ADD COLUMN IF NOT EXISTS session_name VARCHAR(100);

-- 3. Ensure day_of_week is nullable for sequential assignments
ALTER TABLE workout_plan_template_assignments 
  ALTER COLUMN day_of_week DROP NOT NULL;

-- 4. Check constraints
ALTER TABLE workout_plan_templates DROP CONSTRAINT IF EXISTS chk_workout_plan_schedule_type;
ALTER TABLE workout_plan_templates ADD CONSTRAINT chk_workout_plan_schedule_type CHECK (schedule_type IN ('weekly', 'sequential'));

ALTER TABLE workout_plan_templates DROP CONSTRAINT IF EXISTS chk_workout_plan_entry_mode;
ALTER TABLE workout_plan_templates ADD CONSTRAINT chk_workout_plan_entry_mode CHECK (entry_mode IN ('prompt', 'prefill'));

-- 5. Session index lookup
CREATE INDEX IF NOT EXISTS idx_workout_plan_assignments_template_session 
  ON workout_plan_template_assignments (template_id, session_index);

