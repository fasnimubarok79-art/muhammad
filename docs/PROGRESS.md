# ClipKita-Pro progress

Read this first at the start of every session. One phase per session.

## Current phase

**Phase 3: video audit report + word cards.** Done and merged to `main`.
**Next: Phase 4** (proposed): professional editor core. It needs a multi-track timeline data model, which is a database change, so it waits for owner approval (see "Master continuation prompt" below).

Phases: 0 audit (done, `feat/clipkita-pro-phase-0`), 1 rebrand and flags (done, `feat/clipkita-pro-phase-1`), 2 Cinematic Punch (done, `feat/clipkita-pro-phase-2`), 3 audit report and word cards (done, `feat/clipkita-pro-phase-3`).

This file is the single status document. `README.md` covers architecture and setup, `CHANGELOG.md` the release notes, `RECOVERY.md` backup and recovery, `docs/reference/` the style references. The continuation prompt's list (PROJECT_STATUS, HANDOVER, TEST_REPORT and so on) maps onto these files instead of new duplicates.

## Master prompt received

`ClipKita_Pro_Master_Prompt.md` (2026-11-04). Sections 1 to 3 and the first paragraphs of 5 to 8 have content. **Sections 4 (structure and tables), 9 to 12, the whole second document (sections 1 to 19) and the addendum (16 to 23) are headings only.** Requirements that only exist as a heading are not implemented and are listed as "spec missing" below.

## Prerequisites (checked, not assumed)

Development session (cloud container, Linux):

| Item | Status |
|---|---|
| Git | 2.43.0 |
| Node.js / pnpm | v22.23.4 / 10.28.0 (project currently uses npm + package-lock) |
| Python | 3.13.18 (worker venv) |
| PostgreSQL | 16.15 |
| Redis | 7.0.15 installed, not used by the app yet |
| Docker | 29.9.2 installed, daemon not running |
| FFmpeg | 6.1.1 with `ass`, `subtitles`, `vidstabdetect`, `vidstabtransform` |
| faster-whisper, OpenCV, yt-dlp | installed in `.venv` |
| PySceneDetect, MediaPipe | not installed |
| Ollama | not installed |
| API keys (LLM, cloud STT, YouTube Data API) | none set |

Owner laptop (Windows, from earlier sessions, not re-checked here): project at `C:\clipkita-pro` (the prompt says `D:\clipkita`, but that laptop has no D: drive), Node 26, Python 3.12, FFmpeg 9.0.2 at `C:\ffmpeg`, PostgreSQL 18 run from `C:\clipkita-pg` without admin rights, Git. Docker Desktop, WSL2 and Ollama: unknown.

## Requirement map (prompt vs current code)

Legend: DONE (implemented and tested), PARTIAL, MISSING, CONFLICT (differs from an earlier owner decision), SPEC MISSING.

| Prompt item | Status | Notes |
|---|---|---|
| Rebrand to ClipKita-Pro, slug `clipkita-pro` | DONE | Title, wordmark, package, Docker, scripts, docs. the rebrand search from the master prompt returns nothing outside CHANGELOG.md |
| Env prefix `CKP_` | DONE | `src/lib/env-alias.ts`: CKP_ wins, old names still work; `DATABASE_URL` unchanged on purpose. Verified with a CKP_-only env file |
| Database name `clipkita_pro` | PARTIAL | New installs create `clipkita_pro`. Existing installs: documented move via backup + restore (README), to be run by the owner |
| Owner role via seed/CLI only, unlimited | DONE | Owner display name "Muhammad Fasni Mubarok" set by seed (`CKP_OWNER_NAME`) |
| Branch per phase, small commits, no secrets or videos in git | DONE | `.gitignore` covers `.env`, storage, logs |
| Evidence-based reports | DONE | Tests, ffprobe checks, screenshots in earlier sessions |
| No dead buttons; unbuilt features hidden by `config/features.ts` | DONE (labels) | `config/features.ts` added. "In development", "not available", "NEED CONFIGURATION" texts removed; untested OAuth linking hidden and its routes return 404 while off. Automated dead-button crawler still MISSING |
| Dashboard numbers from database | DONE | |
| AI scores shown as estimates with factors | DONE | Viral, hook, engagement with reasons |
| 1. Sign up, login | DONE | Email + password |
| 1. Email verification, Google OAuth, Free plan | MISSING | Needs a mail provider and Google OAuth credentials; plans do not exist (token system instead) |
| 2. Upload, drag-and-drop, progress bar | PARTIAL | Streaming upload with progress; not resumable, no drag-and-drop zone |
| 2. YouTube URL: official metadata, captions via owner OAuth, file by upload | CONFLICT | Current build downloads public videos with yt-dlp after a rights checkbox (owner request on 2026-11-02). The new prompt says official path only and file by upload |
| 3. Rights checkbox stored with time and IP | PARTIAL | Checkbox required; stored in the audit log with time and IP, not on the project row |
| 4. Background audit with live per-stage progress | PARTIAL | DB queue + polling; stages validate, download, analyze, transcribe, clip. No scene/face/LLM stage in analysis; no SSE |
| 5. Audit report (topics, moment map, speakers, source quality) | PARTIAL | `/projects/[id]/audit/[sourceId]` + `GET /api/sources/[id]/audit` (JSON download): live ffprobe, speech stats, pauses, scenes, cut points, highlights, B-roll windows, moment map. No topics, no speaker diarization, no PDF |
| 6. 5 to 20 clips with title, hook, description, scores, reasons, transcript, platforms | DONE | Clip detection v2 |
| 7. Presets Cinematic Punch, Clean Podcast, Edu Explainer | PARTIAL | Cinematic Punch done from the reference video, with word cards (no B-roll yet). Clean Podcast and Edu Explainer map to the existing `cinematic_podcast` and `educational` presets |
| 7. Reframe, animated captions, zoom, color grade, audio enhancement | DONE | Follow-face reframe, karaoke/pop/impact captions, zoom, grade, loudnorm |
| 7. Transitions | MISSING | |
| 8. Timeline editor: timestamps, trim, split, subtitle style, crop | DONE | |
| 8. Zoom keyframes, B-roll, music, watermark | MISSING | |
| 9. Quality audit 0 to 100 with auto-fix | MISSING | |
| 10. Export one clip with progress and download | DONE | 450p/720p/1080p, ffprobe-verified |
| 10. Batch export, 4K, completion notification | PARTIAL | Bell shows finished jobs; no batch, no 4K |
| 11. History, delete files and project, quota | DONE | Delete removes storage files; token usage page |
| 11. Upgrade plan, payments | MISSING / SPEC MISSING | Section 10 "Pembayaran" is a heading only |
| Architecture: Next.js + FastAPI + Python worker + Redis + MinIO + SSE | CONFLICT | Today: Next.js (UI + API), Node worker calling Python for STT/CV, PostgreSQL as queue, local storage. Working and tested |
| UUID v7 ids, soft delete | MISSING | cuid ids, hard delete. Changing ids is a destructive migration |
| `LLMProvider` / `STTProvider` interfaces, versioned prompts | MISSING | STT is faster-whisper directly; no LLM yet |
| FFmpeg filtergraph from EDL in `apps/worker/ffmpeg/builder.py` | PARTIAL | Exists in TypeScript (`src/lib/media/render.ts`) with tests |
| DoD: Playwright E2E for steps 1 to 11 | PARTIAL | API E2E (67 checks) in repo; browser checks only as dev scripts |
| DoD: ffprobe + `ffmpeg -v error -f null` on exports | PARTIAL | ffprobe verification in every render; decode check not yet |
| DoD: subtitle sync within 150 ms | DONE (punch captions) | Burned-in measurement, worst offset 30 ms over 16 events. See `docs/reference/cinematic-punch.md` |
| DoD: dead-button crawler test | MISSING | |
| DoD: CI for typecheck, lint, tests, build | MISSING | Runs locally only |
| DoD: Lighthouse ≥ 90 | MISSING (not measured) | |
| `tests/fixtures/owner/` (git-ignored) for the owner's own video | DONE in this phase | Waiting for the owner's 3 to 10 minute Indonesian video |
| Style reference video | DONE | Owner uploaded it on 2026-11-05. Patterns in `docs/reference/cinematic-punch.md`; the file and its assets are not committed |
| Pinterest reference engine, AI style matching, live video import, backup/failover addendum | SPEC MISSING | Headings only. Note: Pinterest content is only usable through its official API with app approval |

## Master continuation prompt (2026-11-05): status against its phases

Statuses use the prompt's terms. "Verified" means tested in this repo with the evidence listed in the log.

| Prompt phase | Status | What exists / what is missing |
|---|---|---|
| 3. Video audit report | VERIFIED WORKING (partial scope) | File, codecs, aspect, fps, size, speech, language, pauses, scenes, cut points, highlights, B-roll windows, subtitle counts, JSON export. Missing: PDF export, topics |
| 3. Word cards | VERIFIED WORKING | Grid, paper, black, accent backgrounds; serif or bold sans; size, height, colours, fade/pop/cut; Studio "Cards" tab, timeline lane (drag to move), preview, autosave, undo; burned in by the worker via ASS |
| 4. Professional editor | PARTIALLY WORKING | Exists: trim handles, subtitle lane (move edges, split, delete), snap, zoom, 50-step undo/redo, local + server autosave, draft recovery, shortcuts (Space, S, Delete, Ctrl+Z/Y/S, arrows). Missing: media library, multi-track video/audio/overlay/B-roll, drag-and-drop media, duplicate, ripple delete, track lock/mute/hide, multi-select, markers, transform and keyframes, speed, frame stepping, audio replacement, proxy preview. **Needs a timeline data model (DB change): owner approval first** |
| 5. AI clip generator | PARTIALLY WORKING | Upload, link import (yt-dlp, rights checkbox), ffprobe, Whisper word times, silences, scenes, hook/engagement scores with reasons, 5 to 20 candidates, edit before render. Missing: semantic highlight model (no LLM configured), transcript editor on the source level |
| 6. Subtitles and effects | PARTIALLY WORKING | 5 animations, colours, size, outline, shadow, position, SRT/VTT in and out, Cinematic Punch. Missing: font family choice, Cinematic Punch sliders (zoom, flash, vignette), saved custom presets, light leak, grain, PiP, split screen |
| 7. Website and dashboard | PARTIALLY WORKING | Landing with a playing demo, dashboard, gallery, projects (rename, delete), export history, tokens. Missing: duplicate/archive projects, before/after showcase from a real render |
| 8. Render and export | PARTIALLY WORKING | 9:16, 16:9, 1:1; 450p/720p/1080p; H.264 + AAC; queue states, cancel, ffprobe verification. Missing: 4:5, quality presets, GPU encode (NVENC not verified on the owner's laptop), concurrency setting in the UI |
| 10. Tokens | VERIFIED WORKING | Backend ledger, idempotency, refunds, owner unlimited (Phase 0/1 evidence) |
| 13. Demo project "CLIPKITA CINEMATIC PUNCH DEMO" | BLOCKED | Needs talking-head footage the owner has the rights to. The reference video may not be used. Place a file in `tests/fixtures/owner/` and it can be rendered through the pipeline |

## Owner decisions (2026-11-04)

1. Architecture: **keep** Next.js + Node worker + PostgreSQL queue. Add Redis/FastAPI only when a feature needs it.
2. YouTube: **keep yt-dlp** link import with the rights checkbox (overrides the prompt's official-only rule).
3. Rebrand: **gradual**. Display name now; `CKP_` env names read first with the old names still accepted; database moved to `clipkita_pro` through the tested backup and restore when the owner runs it.
4. Billing: **keep the token system**. Plans and payments wait for a written spec.
5. Still open: the missing text of the master prompt (sections listed above as SPEC MISSING).

## Technical debt

- No CI pipeline.
- Rate limiter is in memory (single instance only).
- Browser QA scripts live outside the repo.
- Existing laptop install still on database `clipkita` until the owner runs the documented move.

## Log

- 2026-11-04 Phase 0 audit written; branch created; `tests/fixtures/owner/` added and ignored.
- 2026-11-04 Phase 1: rebrand, CKP_ env names, owner name, feature flags. Evidence: rebrand grep empty, 100 unit/integration tests, 67 API E2E checks, build, CKP_-only env run, browser check of 11 pages (no banned labels, no console errors).
- 2026-11-05 Phase 2: Cinematic Punch preset (punch captions with keyword pop-in, punch-in zoom on sentence starts, flash cuts, warm grade), Studio preview and options. Evidence: subtitle sync worst 30 ms, real sample render passed ffprobe and full decode, `tests/punch.test.ts`, full verify suite.
- 2026-11-05 Phase 3: video audit report (page, API, JSON download) and word cards (render, preview, editor, timeline lane), bundled Instrument Serif (OFL). Evidence: `tests/cards.test.ts`, `tests/audit.test.ts`, worker render with a paper card measured in the output (luma 219.6 on the card vs 123.7 off), browser checks (15 passed: ownership 404/401, overflow at 1440 and 390, preview font, autosave, undo, no console errors), API E2E 67/67, subtitle sync still 30 ms, 113 unit tests, build.
