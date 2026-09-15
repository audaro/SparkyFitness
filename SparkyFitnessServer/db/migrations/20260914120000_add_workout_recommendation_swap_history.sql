-- Every exercise the current Swap chain has already shown, so the next Swap can
-- avoid all of them rather than only the workout it is replacing.
--
-- The engine is deterministic and Swap works by penalizing exercise ids. With
-- only the outgoing workout's ids penalized, the second Swap penalized B and
-- got A back, the third penalized A and got B back: two workouts forever. The
-- chain remembers the ids of every workout it has produced (the first one
-- included), and a plain regenerate starts a fresh chain. When a Swap can find
-- nothing outside the chain, the service resets the chain to the workout it
-- just built, so the rotation restarts from the top instead of freezing.
--
-- UUID[] rather than JSONB: it is a flat list of exercise ids and nothing else,
-- node-postgres renders a JS array as exactly this column's literal, and a
-- typed array cannot hold a stray shape the way an unchecked JSONB can. Not a
-- payload field, because the payload schema is strict and shared with both
-- clients, and this is bookkeeping the client never needs.
ALTER TABLE public.workout_recommendations
    ADD COLUMN IF NOT EXISTS swap_excluded_exercise_ids UUID[] NOT NULL DEFAULT '{}';
