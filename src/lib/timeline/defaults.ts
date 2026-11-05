import { keepIntervals } from "../media/render";
import { defaultTracks, mainTrack, newId } from "./ops";
import type { Item, TimelineDoc, Transform } from "./schema";

export const DEFAULT_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: "contain", crop: { l: 0, t: 0, r: 0, b: 0 } };

/** Timeline frame rate for a source: its own rate when it is a standard one, else 30. */
export const pickFps = (fps: number | null | undefined): 24 | 25 | 30 | 60 => {
  const r = Math.round(fps ?? 30);
  return r === 24 || r === 25 || r === 60 ? r : 30;
};

export const CANVAS: Record<"9:16" | "16:9" | "1:1", { w: number; h: number }> = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 }, "1:1": { w: 1080, h: 1080 } };

export function blankItem(trackId: string, kind: Item["kind"], durationFrames: number, ref: { mediaAssetId?: string; sourceVideoId?: string } = {}): Omit<Item, "id" | "startFrame"> {
  return {
    trackId,
    kind,
    mediaAssetId: ref.mediaAssetId ?? null,
    sourceVideoId: ref.sourceVideoId ?? null,
    durationFrames,
    sourceInFrame: 0,
    speed: 1,
    opacity: 1,
    volume: 1,
    transform: kind === "video" || kind === "image" ? { ...DEFAULT_TRANSFORM, crop: { ...DEFAULT_TRANSFORM.crop } } : kind === "text" ? { ...DEFAULT_TRANSFORM, y: 0.3, crop: { ...DEFAULT_TRANSFORM.crop } } : null,
    effects: kind === "effect" ? { fadeIn: 0, fadeOut: 0, type: "zoom", intensity: 0.5 } : { fadeIn: 0, fadeOut: 0 },
    keyframes: [],
    text: null,
  };
}

/**
 * The timeline a clip gets when it is first opened in the editor (or rendered without one): its saved
 * trim window on the main track, already cut at silences when the old "remove silences" switch was on,
 * so nothing about an existing clip changes.
 */
export function defaultTimeline(opts: {
  clip: { startSec: number; endSec: number; sourceVideoId: string };
  sourceDurationSec: number;
  aspect: "9:16" | "16:9" | "1:1";
  trimStart?: number;
  trimEnd?: number;
  removeSilence?: boolean;
  silences?: Array<{ start: number; end: number }>; // source seconds
  fps?: 24 | 25 | 30 | 60;
  id?: string;
}): TimelineDoc {
  const fps = opts.fps ?? 30;
  const len = opts.clip.endSec - opts.clip.startSec;
  const tStart = Math.max(0, Math.min(opts.trimStart ?? 0, len - 0.5));
  const tEnd = Math.max(tStart + 0.5, Math.min(opts.trimEnd ?? len, len));
  const absStart = opts.clip.startSec + tStart;
  const absEnd = Math.min(opts.sourceDurationSec, opts.clip.startSec + tEnd);
  const win = absEnd - absStart;
  const local = (opts.silences ?? [])
    .map((s) => ({ start: s.start - absStart, end: s.end - absStart }))
    .filter((s) => s.end > 0 && s.start < win)
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(win, s.end) }));
  const keep = opts.removeSilence ? keepIntervals(win, local) : [{ start: 0, end: win }];
  const tracks = defaultTracks();
  const doc: TimelineDoc = { id: opts.id ?? newId(), fps, width: CANVAS[opts.aspect].w, height: CANVAS[opts.aspect].h, playheadFrame: 0, tracks, items: [], markers: [] };
  const main = mainTrack(doc);
  let at = 0;
  for (const k of keep.length ? keep : [{ start: 0, end: win }]) {
    const srcIn = Math.round((absStart + k.start) * fps);
    const dur = Math.max(1, Math.round((absStart + k.end) * fps) - srcIn);
    doc.items.push({ ...blankItem(main.id, "video", dur, { sourceVideoId: opts.clip.sourceVideoId }), id: newId(), startFrame: at, sourceInFrame: srcIn });
    at += dur;
  }
  return doc;
}
