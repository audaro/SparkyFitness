-- Progress photo comparison: cached measurements and cached pairs.
--
-- Both tables are caches over work done elsewhere -- running a pose model over
-- a photo, and fitting one photo onto another -- so both are safe to truncate
-- and rebuild. Nothing the user typed lives here.
--
-- Deliberately absent: a `verdict` column. Whether two photos may honestly be
-- compared is decided by thresholds in `@workspace/shared`, which will be
-- tuned as real pairs accumulate. Storing the answer would freeze last
-- month's judgement onto this month's rule, so these tables store only what
-- was measured and the verdict is recomputed on every read.
--
-- Guarded with IF NOT EXISTS throughout so the script is safe to re-run.

BEGIN;

-- 1. One row per analysed photo.
--
-- `engine` is the model and metric version that produced `metrics`. Upgrading
-- the sidecar changes it, which is how stale rows are recognised and redone;
-- numbers from two different engines must never be subtracted from each other.
CREATE TABLE IF NOT EXISTS public.check_in_photo_analysis (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    -- Denormalised from check_in_photos so the check-in RLS policy, which
    -- reads user_id directly off the row, applies here unchanged.
    user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    photo_id uuid NOT NULL REFERENCES public.check_in_photos(id) ON DELETE CASCADE,
    engine text NOT NULL,
    -- Null together with a non-null failure_reason: a photo the model could
    -- not find a body in is a fact worth caching, or every page view pays for
    -- the same failed inference again.
    metrics jsonb,
    -- (33, 3) landmarks, kept so a pair can be re-fitted without re-running
    -- the model on photos that have already been measured.
    landmarks jsonb,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    -- One current analysis per photo. A re-run replaces it rather than
    -- accumulating a history nothing reads.
    CONSTRAINT check_in_photo_analysis_photo_unique UNIQUE (photo_id),
    CONSTRAINT check_in_photo_analysis_outcome_check CHECK (
        (metrics IS NOT NULL AND landmarks IS NOT NULL AND failure_reason IS NULL)
        OR (metrics IS NULL AND landmarks IS NULL AND failure_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_check_in_photo_analysis_user
    ON public.check_in_photo_analysis (user_id);

COMMENT ON TABLE public.check_in_photo_analysis IS
  'Cached pose measurements for one progress photo. Derived data only; safe to rebuild.';
COMMENT ON COLUMN public.check_in_photo_analysis.engine IS
  'Model and metric version that produced these numbers. Measurements from different engines are not comparable.';
COMMENT ON COLUMN public.check_in_photo_analysis.failure_reason IS
  'Stable token from the vision service (pose_not_detected, landmark_not_visible:ankles) when no body was found.';

-- 2. One row per compared pair.
CREATE TABLE IF NOT EXISTS public.progress_photo_comparisons (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    before_photo_id uuid NOT NULL REFERENCES public.check_in_photos(id) ON DELETE CASCADE,
    after_photo_id uuid NOT NULL REFERENCES public.check_in_photos(id) ON DELETE CASCADE,
    engine text NOT NULL,
    -- Layer 1: both photos' metrics, the alignment fit and the exposure delta.
    -- Null when either photo has no analysis to compare.
    deterministic jsonb,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT progress_photo_comparisons_pair_unique
        UNIQUE (user_id, before_photo_id, after_photo_id),
    -- A photo compared against itself is a null result dressed up as a
    -- measurement, and would read as "no change" in a report.
    CONSTRAINT progress_photo_comparisons_distinct_check
        CHECK (before_photo_id <> after_photo_id),
    CONSTRAINT progress_photo_comparisons_outcome_check CHECK (
        (deterministic IS NOT NULL AND failure_reason IS NULL)
        OR (deterministic IS NULL AND failure_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_progress_photo_comparisons_user_created
    ON public.progress_photo_comparisons (user_id, created_at DESC);

COMMENT ON TABLE public.progress_photo_comparisons IS
  'Cached measurements for one before/after pair. The comparability verdict is not stored: it is recomputed from these numbers so threshold changes take effect immediately.';

COMMIT;
