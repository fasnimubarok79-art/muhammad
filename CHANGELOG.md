# Changelog

## 2026-11-05 · Phase 6: subtitle studio – Hormozi / Pro Shorts preset & Transcript Editor
- New "Hormozi" card style: black background, bold Inter Black at 210px, uppercase text, thick black outline and drop shadow. Shown in CardPanel style picker and CardView preview.
- New "hormozi" subtitle preset: every word is its own ASS event; inactive words are white with thick black outline/shadow, the active word flashes bright `#FFD21F` highlight and scales up via `\t(0,N,\fscx135\fscy135)` so it pops when spoken.
- Verified end-to-end with a real FFmpeg burn-in: 5s 1080×1920 MP4, H.264/AAC, all `\t` `\fscx` `\fscy` animation tags render through the `ass` filter.
- Transcript Editor panel in the Studio left sidebar ("Transcript" tab): word-level subtitle editing with inline text fixes, per-word timing nudges within bounds, merge/split/add/delete lines, and real-time active-word highlighting synced to the playhead. Edits flow through `useEditor.commit` (undo/redo + debounced server save).

## 2026-11-05 · Phase 5: quality audit
- Every finished render is measured on the actual MP4: technical format and duration, a full decode, sharpness, loudness/true peak and A/V duration alignment. Black and frozen intervals are reported as diagnostics.
- The export dialog and the Exports page show a 0 to 100 score, an A/B/C/D grade, findings and concrete recommendations.
- A full-decode error is fatal: the damaged file is deleted and the job fails instead of delivering it.
- Auto-fix is not built; the audit only reports. Loudness normalisation already happens during the render.

## 2026-11-05 · Phase 4: editor core
- Multi-track timeline in the Studio: main video, B-roll, overlay, text, effects, audio, subtitle and card tracks; move, trim, split, duplicate, delete, ripple delete, lock, mute, hide, markers, snapping, multi-select.
- Media library: upload video, audio and images, search, filter, sort, preview, rename, safe delete.
- Inspector with transform, crop, speed, volume, fades and keyframes (position, scale, opacity, volume).
- Autosave with version checks and a conflict choice; renders follow the timeline exactly.
- Database: five new tables (additive). The Windows start script backs up before applying migrations.

## 2026-11-05 · Phase 2 and 3
- **Cinematic Punch** preset: keyword pop-in captions, punch-in zoom on sentence starts, flash cuts, warm grade.
- **Word cards**: full-frame text inserts (grid, paper, black, accent) in the Studio "Cards" tab and timeline, burned into the render. Bundles the Instrument Serif font (SIL OFL).
- **Video audit report** per source video: file and codec facts from ffprobe, speech, pauses, scenes, cut points, highlights, B-roll windows, moment map, JSON download.

## 2026-11-04 · ClipKita-Pro
- Product renamed to **ClipKita-Pro** (slug `clipkita-pro`). It merges two earlier specs, CLIPGEN AI (video audit, viral clip detection, editor, export) and CLIPFORGE AI STUDIO (CapCut-style editing, quality auditor, subtitle studio, templates), and the earlier working name "CLIPKITA AI PRO MAX".
- Environment variables use the `CKP_` prefix; unprefixed names still work. `DATABASE_URL` keeps its name.
- New installs use the `clipkita_pro` database. Existing installs move with backup and restore (see README).
- Unbuilt features are hidden through `config/features.ts`.

## 2026-11-03
- Backup and restore tooling, premium app shell, export history, settings, follow-face reframing, Viral Spotlight preset, vertical clip gallery.

## 2026-11-02
- First working version: upload and link import, Whisper transcription, clip detection, subtitle editor, FFmpeg render, tokens, owner admin.
