-- Guided progress-photo capture: what the app knew about the conditions a
-- photo was taken under.
--
-- Until now nothing recorded *how* a progress photo was shot, so nothing could
-- say whether two of them are comparable. A before/after report that cannot
-- tell a lighting change from a body change is worse than no report, so the
-- capture conditions are recorded at upload time and the comparison reads them
-- later.
--
-- Nullable with no default, and null means "unknown": every photo taken before
-- this migration, and every library import, has no capture conditions. The
-- comparison pipeline must treat absence as unknown rather than as zero tilt in
-- neutral light, which is why nothing here is backfilled with a guess.
--
-- JSONB rather than columns because the payload is versioned (`v`) and grows
-- with the capture screen — the sensor-backed tilt fields land in a later
-- build, since a native module cannot ride an over-the-air update. The shape is
-- enforced by Zod at the one write path (the upload route), matching how
-- coach_profiles vocabularies are enforced; a CHECK constraint would reject the
-- write with an error no client could render.
ALTER TABLE public.check_in_photos
    ADD COLUMN IF NOT EXISTS capture_meta JSONB;

COMMENT ON COLUMN public.check_in_photos.capture_meta IS
    'Versioned capture conditions (capture_mode, device, facing, reference photo, timer, tilt, local time). Null means unknown: the photo predates guided capture or came from the library.';
