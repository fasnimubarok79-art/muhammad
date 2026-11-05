# Changelog

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
