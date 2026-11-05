# Cinematic Punch: reference notes

The owner supplied one reference video on 2026-11-05. It is a vertical short with a talking head, edited in a fast "punch" style. Only its editing patterns were studied. **No frames, music, fonts, logos, watermark, B-roll or text from it are in this repo**, and the reference file itself is not committed.

## What the reference does (observed from a frame contact sheet)

| Pattern | Observation |
|---|---|
| Pacing | A new shot or framing every ~1.5 to 3 s |
| Punch-in | Wide shot and close crop alternate on sentence starts |
| Captions | Small white context words, with one big italic uppercase keyword under them |
| Keyword colour | Rotates (blue, red, green, ...) with a soft glow of the same colour |
| Grade | Warm, slightly dark, higher contrast, vignette |
| Transitions | Short white flash, blur and light-leak cuts |
| Inserts | Paper-grid word cards, black word cards, black-and-white stock B-roll |
| Branding | A creator watermark. Not copied and not imitated |

## What the `cinematic_punch` preset implements

| Pattern | Implementation | File |
|---|---|---|
| Punch-in | `punchPlan()` alternates wide and 1.3x punched shots on subtitle segment starts (min gap 1.6 s, max hold 3.2 s), falling back to every 2.4 s. The zoom is a hard cut, applied in the same crop expression as the slow zoom | `src/lib/media/render.ts`, `worker/pipeline.ts` |
| Flash cut | `eq=brightness` pulse of +0.22 for 70 ms at every punch in and out | `src/lib/media/render.ts` |
| Grade | contrast 1.16, saturation 1.06, brightness -0.02, gamma 0.94, warm 0.06, sharpen 0.45, vignette, 0.15 s fades | `PRESETS.cinematic_punch` |
| Captions | Subtitle preset `punch`: context line appears at the segment start; the keyword (`keywordIndex()`: longest non-stopword, Indonesian and English stoplists) pops in at its own Whisper word time, italic, uppercase, 1.9x size, 135% to 100% scale over 110 ms, glow layer underneath | `src/lib/media/subtitles.ts` |
| Keyword colours | Own palette `#3FA9FF`, `#FF3B3B`, `#3DDC72`, `#FFD21F`, rotating per segment | `PUNCH_COLORS` |
| Font | Inter Black (OFL), already bundled in `worker/fonts` | |
| Studio preview | Player draws the same context and keyword layout and timing | `src/components/studio/Player.tsx` |

## Not implemented (deliberately)

- Word cards (paper-grid or black interstitials): they need a card template system and a timeline lane for inserts.
- B-roll: no licensed stock source. `FEATURES.bRoll` stays false.
- Light-leak and blur transitions: only the flash is done.
- Stickers, emoji and gradient text.

## Evidence

- Subtitle sync: punch captions from real Whisper word times (JFK sample, 10 segments) were burned over a static frame. Caption-band luma changes were detected per frame and compared with every expected event (segment start and keyword onset). Result: 16 of 16 events matched, **worst offset 30 ms** (DoD limit 150 ms; one frame at 30 fps is 33 ms).
- A real 10.8 s sample render with this preset passed `ffprobe` (1080x1920, H.264 + AAC) and a full decode with `ffmpeg -v error -f null` without errors.
- Unit tests: `tests/punch.test.ts` covers keyword choice, event timing, colour rotation, `punchPlan` limits, and the punch zoom and flash filter expressions.
