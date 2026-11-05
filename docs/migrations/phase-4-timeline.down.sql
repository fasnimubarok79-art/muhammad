-- Rollback for 2026110510_timeline_media. Drops ONLY the objects that migration created.
-- Run with the app and worker stopped, after a backup. Then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '2026110510_timeline_media';
BEGIN;
DROP TABLE IF EXISTS "TimelineMarker";
DROP TABLE IF EXISTS "TimelineItem";
DROP TABLE IF EXISTS "TimelineTrack";
DROP TABLE IF EXISTS "Timeline";
DROP TABLE IF EXISTS "MediaAsset";
DROP TYPE IF EXISTS "TrackType";
DROP TYPE IF EXISTS "MediaKind";
COMMIT;
