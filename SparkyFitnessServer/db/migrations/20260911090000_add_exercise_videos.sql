-- Demonstration videos for an exercise. Stored the way `images` is: a JSON
-- array of strings, each a server-relative path under /uploads/exercises or
-- an absolute URL, served by the same on-demand uploads route (sendFile sets
-- the MIME type from the extension and honours Range requests, which is all
-- a native or HTML5 video player needs).
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS videos TEXT;
