# DESIGN.md · CLIPKITA AI PRO MAX

Direction for every UI in this project. Agents read this first, then apply the `antislop` skill as the filter.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

> Reading this as: a video clipping and editing tool for short-form creators, in a "cutting room" style: dark editing-suite surfaces, one warm accent that belongs to the edit (orange), one cool accent that belongs to the system (mint). Dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Overview

- **Why dark:** this is a video editor. A neutral dark surround is the industry norm because it keeps the picture the brightest thing on screen and stops the UI from biasing colour judgement. It is a functional choice, not a "tech look".
- **Identity motif:** the **timecode**. Tabular `00:12.40` timestamps and thin tick marks (like a timeline ruler) appear wherever time matters: clip cards, the landing preview, the job list. It is the one recurring visual idea.
- **Two accents, two jobs, never swapped:**
  - **Edit orange** marks things that change the video: the primary edit/export action, the active subtitle word, the playhead.
  - **System mint** marks state: connected, processing, completed, focus rings.
- **Dropped from the brief, on purpose:** violet `#8B5CF6` (a third accent breaks the two-job rule), decorative grid backgrounds and glow on cards. The player keeps a **functional** overlay instead: safe-zone guides and rule-of-thirds, toggled by the user.

## Colors

Measured with `.claude/skills/antislop-human/contrast-check.py`.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | `#0B0F19` | App background | n/a |
| `--surface` | `#121826` | Panels, cards | n/a |
| `--surface-2` | `#1A2232` | Inputs, hovered rows, timeline tracks | n/a |
| `--line` | `#263046` | Hairline borders (decorative) | n/a |
| `--ink` | `#E8ECF4` | Primary text | 16.17:1 on bg |
| `--ink-muted` | `#9AA4B6` | Secondary text | 7.62:1 on bg, 6.34:1 on surface-2 |
| `--ink-faint` | `#5B6478` | Disabled, tick marks. **Never body text** | 3.23:1 |
| `--edit` | `#FF7A1A` | Edit accent: primary action, active word, playhead | 7.34:1 on bg |
| `--on-edit` | `#0B0F19` | Text on orange fills | 7.34:1 |
| `--system` | `#3DDC97` | State, focus ring, connected, done | 10.84:1 on bg |
| `--on-system` | `#0B0F19` | Text on mint fills | 10.84:1 |
| `--warn` | `#FFC24D` | Warnings, PREVIEW_ONLY | 11.92:1 |
| `--danger` | `#FF6B6B` | Errors, failed jobs, destructive actions | 6.39:1 on surface |

Rules: no gradients on UI chrome, no glow on cards or buttons. One permitted glow: the **active subtitle word** in the karaoke preset, because it is part of the video output, not the UI.

## Typography

| Role | Family | Why |
|---|---|---|
| Display | **Archivo** (variable, 700 to 800, `font-stretch: 112%`) | Wide, sturdy grotesque. It reads like slate and label tape and gives headings a voice that is not the default. |
| UI and body | **Inter** (variable, 400 / 500 / 600) | Dense UI legibility at 12 to 14px in panels. |
| Timecode and numbers | Inter with `tabular-nums` | Timestamps line up in lists and on the ruler. |
| Burned-in subtitles | **Inter 800/900** | The same file is used in the browser preview and by FFmpeg/libass, so the preview matches the export. |

Scale: 12 / 13 / 14 / 16 / 20 / 28 / `clamp(36px, 5vw, 64px)`. Sentence case everywhere. No all-caps eyebrow pills.

## Layout

- 4px base. Panel padding 12 to 16, section spacing on marketing pages 64 to 120. Spacing is not uniform.
- **Editor (≥1280px):** left panel 240px, centre flexible, right inspector 320px, bottom timeline 240px (resizable up to 42vh).
- **Below 1024px:** the editor shows preview, playback and subtitle text editing only, plus a notice: "Editing timeline needs a wider screen". Galleries and dashboards stay fully usable on phones.
- Landing page RHYTHM 2: the hero is a working input, not a mock. Sections change composition, so the page never repeats "title + subtitle + three identical cards".

## Elevation & Depth

Depth comes from surface steps (`--bg` → `--surface` → `--surface-2`) and 1px `--line` borders. Shadows only on floating layers (menus, dialogs, toasts): `0 12px 32px rgb(0 0 0 / .45)`.

## Shapes

Radius 6px for controls, 10px for cards and panels, 999px only for status dots and toggle tracks. The video frame itself is never rounded more than 6px, because it is content.

## Components

- **Primary button:** `--edit` fill, `--on-edit` text, 40px height (44px on touch). One per view.
- **Secondary button:** `--surface-2` fill, `--ink` text, 1px `--line`.
- **Status pill:** dot + text. Never colour alone. Job states map to: queued/validating = muted, downloading/analyzing/transcribing/editing/rendering = mint with progress, completed = mint, failed = danger, cancelled = muted.
- **Access-state badge:** PROCESSABLE (mint), PREVIEW_ONLY (warn), AUTHORIZATION_REQUIRED (warn), UNSUPPORTED (danger). Each one always comes with a plain-language reason and a next action.
- **Clip card:** a real video element (`preload="metadata"`, poster = real thumbnail) that plays only on explicit play, one at a time. Timecode range, duration, title, score shown as "estimate".
- **Focus:** `outline: 2px solid var(--system); outline-offset: 2px` on `:focus-visible`.
- **Required states:** empty, loading, error and populated for every data view.

## Subtitle presets (video output)

| Preset | Look |
|---|---|
| `karaoke` (default) | Inter 900, white, black stroke 0.08em, drop shadow, active word in `--edit` orange with a soft glow, max 2 lines, lower-middle at 72% height |
| `clean` | Inter 700, white, thin stroke, no word highlight |
| `pop` | Inter 900, active word scales in (pop), orange highlight |

Safe zone for 9:16: keep text out of the top 13% and the bottom 21%.

## Motion

MOTION 1. Easing `cubic-bezier(0.23, 1, 0.32, 1)`. Durations 120ms (press, hover), 180ms (menus), 240ms (dialogs). Only `transform` and `opacity`. No animation on keyboard-driven timeline actions (split, nudge, undo). Respect `prefers-reduced-motion`.

## Do's and Don'ts

Do: use real numbers from the backend; show the token cost before every paid action; name buttons after the result ("Render 1080p · 400 tokens").

Don't: fake stats, fake testimonials, invented creator logos, "AI-powered" badges, sparkle icons, em dashes in UI copy, progress bars that are not driven by the backend.

## Responsive Behavior

Breakpoints 640 / 1024 / 1280. Clip gallery: 1 column below 640, 2 columns from 640. Tap targets of at least 44px on touch.

## Iteration Guide

To change an accent, re-run the contrast checker against `--bg`, `--surface` and its `--on-*` pair, then update this table. Code tokens live in `tailwind.config.ts` and `src/app/globals.css`, and they must mirror this file.

## Known Gaps

- Fonts are self-hosted from `@fontsource-variable/*` for the browser. The server needs Inter installed for FFmpeg (`fonts-inter` in Docker) so the burned-in subtitles match the preview.
- No logo has been supplied. The wordmark is set in type until the owner provides one.
