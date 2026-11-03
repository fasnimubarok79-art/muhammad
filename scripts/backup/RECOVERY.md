# ClipKita recovery guide

A backup folder looks like `CLIPKITA_BACKUP/clipkita-<date>-<commit>/` with:

| Folder | Content | Encrypted |
|---|---|---|
| 01_SOURCE_CODE | `source.tar.gz` of the committed code, `GIT_COMMIT.txt` | no |
| 02_DATABASE | `database.dump.enc` (full pg_dump), `schema.sql`, `prisma-migrations.tar.gz`, `ROW_COUNTS.json` | dump only |
| 03_ASSETS | `storage.tar.enc` (uploaded videos, renders, thumbnails), `FILE_LIST.txt` | yes |
| 04_CONFIGURATION | `.env.example`, names of the variables in the live `.env` (no values), config files | no |
| 05_DOCUMENTATION | README, DESIGN, ROADMAP | no |
| 06_DEPENDENCIES | `package.json`, `package-lock.json`, Python requirements, `pip-freeze.txt`, runtime versions | no |
| 07_TEST_REPORT | test output when the backup ran with `--with-tests` | no |
| 08_RECOVERY_TOOLS | these scripts | no |

The encryption key is **not** in the backup. It lives in `BACKUP_KEY_FILE` (default `../CLIPKITA_BACKUP_KEY/backup.key` next to the project). Keep a copy of the key somewhere safe and separate (for example a password manager). Without it the database and media cannot be restored.

## Check a backup

```bash
npm run backup:restore -- --from "C:\CLIPKITA_BACKUP\clipkita-<date>-<commit>" --verify-only
```

## Recovery test (safe: new folder, new database)

```bash
npm run backup:restore -- --from "C:\CLIPKITA_BACKUP\clipkita-<date>-<commit>" --to "C:\clipkita-recovery-test"
```

This verifies every checksum, extracts the code, creates a **new** database (`clipkita_restore_<time>`), restores the dump into it, compares row counts, restores the media files and writes `RESTORE_REPORT.md`. The live project and database are never changed.

Then, inside the recovery folder: create `.env` from `.env.restore` plus your secrets, run `npm ci`, `npm run build`, `npm start`.

## Replacing the live project

Only after a successful recovery test, and only by a person: stop the app, keep the old folder, point the app at the restored folder and database. The scripts never do this automatically.
