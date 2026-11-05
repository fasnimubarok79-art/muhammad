# Migration plan: Phase 4 timeline (additive)

Date: 2026-11-05. Migration: `prisma/migrations/2026110510_timeline_media` (Prisma Migrate, PostgreSQL).

## Checked before writing it

- ORM and migrations: Prisma 6.19.3 with Prisma Migrate. 5 migrations applied, `prisma migrate status` up to date.
- Drift: `prisma migrate diff` migrations → schema and live DB → schema are both empty.
- Existing editor data: subtitles in `SubtitleSegment` (clip-relative seconds), word cards, preset, trim, style and silence removal in `Clip.editConfig` (JSON). No other editor tables.
- Render jobs: `RenderJob.params` carries trim and silence settings. No job was active during the migration.
- Backup: `npm run backup` → `clipkita-pro-20261105-073744-7629cea`, then `--verify-only` (checksums OK for 27 files) and a restore into a separate folder and database `ckp_restore_test` (row counts match for 15 tables).

## What is added

| Object | Purpose |
|---|---|
| enum `MediaKind` | VIDEO, AUDIO, IMAGE |
| enum `TrackType` | VIDEO, AUDIO, SUBTITLE, TEXT, OVERLAY, BROLL, EFFECTS, CARDS |
| table `MediaAsset` | User media library. File on disk under `STORAGE_DIR/assets/...`, never in the DB. `userId` (cascade), `projectId` (set null when a project is deleted, so the asset stays in the library) |
| table `Timeline` | One editing document per clip (`clipId` unique) inside a project. Frame rate, size, `version` for conflict checks, playhead |
| table `TimelineTrack` | Track state: type, order, hidden, muted, locked, volume |
| table `TimelineItem` | Item on a track. Times are **integer frames** at the timeline fps (`startFrame`, `durationFrames`, `sourceInFrame`), so split and trim never drift. References `MediaAsset` (**ON DELETE RESTRICT**: an asset in use cannot be deleted) or `SourceVideo` (cascade) |
| table `TimelineMarker` | Bookmarks: frame, label, colour |

Keyframes, transform and effect settings are JSON columns on `TimelineItem`, validated by one zod schema (`src/lib/timeline/schema.ts`). A separate keyframe table would duplicate that structure without a query that needs it.

## What is not touched

No existing table, column, index or row is changed or dropped. Subtitles stay in `SubtitleSegment` and cards in `Clip.editConfig.cards`; the SUBTITLE and CARDS tracks store only track state (lock, hide) and draw the existing data, mapped through the video items. Clips without a timeline keep rendering exactly as before: the worker builds the same timeline in memory from the render parameters.

## Rollback

1. Stop the web app and the worker.
2. Run `docs/migrations/phase-4-timeline.down.sql` (drops only the five new tables and two enums) and delete the row `2026110510_timeline_media` from `_prisma_migrations`.
3. Check out the previous commit (`7629cea`) and start again.

Old data is unaffected by a rollback because nothing old was changed. If anything else went wrong, restore the backup above with `npm run backup:restore -- --from <backup> --to <folder> --db <name>` (see `scripts/backup/RECOVERY.md`).

## Evidence (2026-11-05, dev database in the build container)

- `prisma migrate deploy` applied `2026110510_timeline_media` inside `BEGIN/COMMIT`.
- Row counts and content hashes of User, Project, SourceVideo, Clip (incl. `editConfig`), SubtitleSegment, RenderJob and TokenTransaction after the migration are **identical** to the pre-migration backup restored into `ckp_restore_test`.
- Rollback tested on `ckp_restore_test`: migration applied (5 new tables), down script run (0 left), old data hashes still identical.

## On the owner's Windows laptop

`scripts/start-windows.ps1` checks `prisma migrate status`; when a migration is pending it runs `npm run backup` first and applies the migration with `prisma migrate deploy` only if the backup succeeded. Manually: `npm run backup`, then `npm run db:migrate`.
