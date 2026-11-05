# ClipKita-Pro: audit and technical roadmap

Status as of the commit that adds this file. "Done" means implemented **and** covered by a test or a run that was actually executed. "Partial" says what is missing.

## Phase 1: audit against the earlier product specs (see CHANGELOG)

| Requirement | Status | Notes |
|---|---|---|
| YouTube URL input | Done (download untested on the real site) | yt-dlp, public videos only, rights checkbox, no cookies/login/live. Tested against a local server; YouTube is blocked in the dev environment. |
| Upload with validation, size and duration limits | Done | Streaming upload, ffprobe check, 500 MB / 120 min by default |
| Metadata and duration | Done | ffprobe |
| Use existing platform subtitles | Missing | Planned: fetch creator-uploaded subtitles with yt-dlp, skip Whisper when good subtitles exist |
| Speech-to-text, word timestamps, ID + EN, punctuation | Done | faster-whisper, language auto-detect or `WHISPER_LANGUAGE=id` |
| Long pauses | Done | ffmpeg silencedetect, used for scoring and silence removal |
| Scene changes | Done | ffmpeg scdet (stored, not yet used in scoring) |
| Speaker changes (diarization) | Missing | Needs a diarization model (pyannote needs a Hugging Face token; or a lighter VAD+embedding approach) |
| 5 to 20 clips by source length, 15/30/45/60 s targets | Done | `clipBudget`, `LENGTH_TARGETS` |
| Viral potential, hook score, engagement score with reasons | Done | Explainable heuristics, labelled as estimates |
| Title, hook, description, timestamps, duration, transcript, platform | Done | Title and hook come from the clip's own transcript |
| Moment types (educational, funny, emotional...) | Partial | Keyword-based, labelled as such. Real understanding needs an LLM (optional, see costs) |
| LLM analysis of the transcript | Missing | Planned as an optional provider; heuristics stay as the free fallback |
| Auto subtitles, animated captions, keyword highlight | Done | Karaoke word highlight, pop, clean presets |
| Silence removal, audio normalisation | Done | Subtitles stay in sync after cuts |
| Smart zoom | Done | Slow push-in per preset |
| Face detection, subject tracking, auto reframing | Done | OpenCV (Haar bundled; optional YuNet via `FACE_MODEL`), smoothed path with hysteresis and speed limit, follows the largest face; preview and render use the same maths |
| Noise reduction | Partial | High-pass + loudness normalisation only; `afftdn` denoise planned as an option |
| Intro / outro, watermark, background customisation | Missing | Planned (FFmpeg overlay / concat) |
| 9:16, 16:9, 1:1 | Done | Never stretched: crop, fit+blur or bars |
| Manual editor: timestamps, trim, subtitle position/font/colour/size, crop, title, preview | Done | Studio with timeline, waveform, undo/redo, autosave |
| Export MP4 720p / 1080p, burned subtitles, progress, ffprobe-verified | Done | 450p/720p/1080p |
| 4K export | Missing | Only meaningful for 4K sources; planned behind a source-resolution check |
| Export several clips at once | Missing | Planned: batch render from the gallery selection |
| Dashboard: videos analysed, clips, minutes processed, projects, render status, activity | Done | All from the database |
| Delete files | Done | Delete project (typed-name confirmation) removes its media files; refused while jobs run |
| Temporary file cleanup | Done for render work files | Source retention policy still to define |
| Quality auditor (sharpness, audio, sync, ratio scores) | Done (report only) | Measured after render with blurdetect, ebur128, a full decode and ffprobe; 0 to 100 score, findings and recommendations. No auto-fix. |
| B-roll, music, sound effects, speed ramp, keyframes, stabilisation, motion blur | Missing | Large items; music/SFX need a licensed library |
| Separate menus | Done | Sidebar: Dashboard, Galeri Klip, Proyek, Klip Viral, AI Video Editor, Subtitle Studio, Riwayat Export, Publikasi, Token, Pengaturan (+ Admin) |
| Purple/blue palette | Not changed | Brand decision pending |

## Phase 2: architecture (current)

- **Web + API:** Next.js 14 (App Router, TypeScript, Tailwind), REST routes under `src/app/api`.
- **Database:** PostgreSQL via Prisma. Job queue is the `RenderJob` table (`FOR UPDATE SKIP LOCKED`), so Redis is not needed for one machine.
- **Worker:** Node process (`worker/`) that runs ffmpeg/ffprobe, yt-dlp and the Python STT script.
- **AI:** faster-whisper (local, CPU). Clip scoring is deterministic and explainable.
- **Storage:** private local folder (`STORAGE_DIR`), media only streamed to the owner.

## Costs and limits

| Item | Free option (current) | Paid option | Limits |
|---|---|---|---|
| Speech-to-text | faster-whisper `small` on CPU | Cloud STT APIs or a GPU server | CPU: roughly 1 to 3 times the video length to transcribe |
| Clip understanding | Heuristic scoring | LLM API (cost per million tokens; a 1-hour transcript is about 15k tokens) | Heuristics cannot judge humour or emotion |
| Link import | yt-dlp | none | Breaks when platforms change: update yt-dlp; public videos only |
| Rendering | FFmpeg on CPU | GPU encoding (NVENC) | 1080p render of a 30 s clip takes about 1 minute on 4 cores |
| Storage | Local disk | Object storage (S3, R2) | Sources up to 500 MB each |

## Roadmap (next phases)

1. **Use platform subtitles when available.** Faster and free; Whisper stays as the fallback.
2. ~~Face-aware reframing~~ done. Next for it: pick the active speaker by mouth movement when several faces are visible.
3. **Batch export and file deletion.** Render several selected clips, delete sources/projects with storage cleanup.
4. **Watermark, intro/outro, background colour/blur options.**
5. ~~Quality audit after render~~ done: sharpness, loudness, full decode, format and A/V alignment with a 0 to 100 score, findings and recommendations. Next for it: optional corrective re-encode (auto-fix).
6. **Optional LLM provider** for titles, hooks and moment understanding, configured by API key.
7. **Speaker diarization.**
8. **Deployment** (Docker image tested, reverse proxy, backups).

## Open decisions for the owner

- Product name: decided, ClipKita-Pro (2026-11-04).
- Palette: the current design uses orange (edit) and mint (system). A purple/blue palette is possible, but it is a brand change that needs `DESIGN.md` updated first.
- Whether to add a paid LLM provider, and which one.

## Backup and recovery (done)

`npm run backup` and `npm run backup:restore` (see README). Verified in development: backup did not change live data, checksums, tamper detection, wrong-key refusal before any write, restore into a new folder and database with matching row counts, and a restored app that built, passed 94 tests against the restored database and showed the same data as the live app.
