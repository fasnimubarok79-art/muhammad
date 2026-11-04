# Changelog

## 2026-11-04 · ClipKita-Pro
- Product renamed to **ClipKita-Pro** (slug `clipkita-pro`). It merges two earlier specs, CLIPGEN AI (video audit, viral clip detection, editor, export) and CLIPFORGE AI STUDIO (CapCut-style editing, quality auditor, subtitle studio, templates), and the earlier working name "CLIPKITA AI PRO MAX".
- Environment variables use the `CKP_` prefix; unprefixed names still work. `DATABASE_URL` keeps its name.
- New installs use the `clipkita_pro` database. Existing installs move with backup and restore (see README).
- Unbuilt features are hidden through `config/features.ts`.

## 2026-11-03
- Backup and restore tooling, premium app shell, export history, settings, follow-face reframing, Viral Spotlight preset, vertical clip gallery.

## 2026-11-02
- First working version: upload and link import, Whisper transcription, clip detection, subtitle editor, FFmpeg render, tokens, owner admin.
