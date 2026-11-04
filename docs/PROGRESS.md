# ClipKita-Pro progress

Read this first at the start of every session. One phase per session.

## Current phase

**Phase 0: audit.** Done for the parts of the master prompt that have content. Waiting for owner decisions (see "Blocking decisions") before Phase 1.

Branch: `feat/clipkita-pro-phase-0`. Base: `main` at `677ad36`.

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
| Rebrand to ClipKita-Pro, slug `clipkita-pro` | PARTIAL | Old names only in `docs/ROADMAP.md` (3 lines). Display name is still "ClipKita", package name `clipkita` |
| Env prefix `CKP_` | MISSING | All variables unprefixed today; renaming breaks the owner's existing `.env` unless old names stay supported |
| Database name `clipkita_pro` | MISSING | Database is `clipkita`; renaming needs backup and restore on the owner's laptop |
| Owner role via seed/CLI only, unlimited | DONE | `OWNER_ADMIN`, `npm run db:seed`, `npm run owner:reset`; owner display name not yet "Muhammad Fasni Mubarok" |
| Branch per phase, small commits, no secrets or videos in git | DONE | `.gitignore` covers `.env`, storage, logs |
| Evidence-based reports | DONE | Tests, ffprobe checks, screenshots in earlier sessions |
| No dead buttons; unbuilt features hidden by `config/features.ts` | CONFLICT | No feature flag file. Editor hub and Publish page show honest "in development / not available" text, which this prompt forbids (hide instead) |
| Dashboard numbers from database | DONE | |
| AI scores shown as estimates with factors | DONE | Viral, hook, engagement with reasons |
| 1. Sign up, login | DONE | Email + password |
| 1. Email verification, Google OAuth, Free plan | MISSING | Needs a mail provider and Google OAuth credentials; plans do not exist (token system instead) |
| 2. Upload, drag-and-drop, progress bar | PARTIAL | Streaming upload with progress; not resumable, no drag-and-drop zone |
| 2. YouTube URL: official metadata, captions via owner OAuth, file by upload | CONFLICT | Current build downloads public videos with yt-dlp after a rights checkbox (owner request on 2026-11-02). The new prompt says official path only and file by upload |
| 3. Rights checkbox stored with time and IP | PARTIAL | Checkbox required; stored in the audit log with time and IP, not on the project row |
| 4. Background audit with live per-stage progress | PARTIAL | DB queue + polling; stages validate, download, analyze, transcribe, clip. No scene/face/LLM stage in analysis; no SSE |
| 5. Audit report (topics, moment map, speakers, source quality) | MISSING | Silences and scenes are stored but not shown as a report; no diarization |
| 6. 5 to 20 clips with title, hook, description, scores, reasons, transcript, platforms | DONE | Clip detection v2 |
| 7. Presets Cinematic Punch, Clean Podcast, Edu Explainer | PARTIAL | Six other presets exist; "Cinematic Punch" spec in section 8 is missing |
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
| DoD: subtitle sync within 150 ms | MISSING (not measured) | |
| DoD: dead-button crawler test | MISSING | |
| DoD: CI for typecheck, lint, tests, build | MISSING | Runs locally only |
| DoD: Lighthouse ≥ 90 | MISSING (not measured) | |
| `tests/fixtures/owner/` (git-ignored) for the owner's own video | DONE in this phase | Waiting for the owner's 3 to 10 minute Indonesian video |
| Style reference video (YouTube Short) | NOT VIEWED | Cannot be watched from here; nothing in `docs/reference/` yet |
| Pinterest reference engine, AI style matching, live video import, backup/failover addendum | SPEC MISSING | Headings only. Note: Pinterest content is only usable through its official API with app approval |

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
- Owner display name in seed is "Owner".
- `docs/ROADMAP.md` still uses the old product names.

## Log

- 2026-11-04 Phase 0 audit written; branch created; `tests/fixtures/owner/` added and ignored.
