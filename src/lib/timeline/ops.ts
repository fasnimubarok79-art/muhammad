import { KF_PROPS, TRACK_ACCEPTS, type Item, type Keyframe, type Marker, type TimelineDoc, type Track, type TrackType } from "./schema";
import { valueAt } from "./keyframes";

/**
 * Non-destructive editing operations on a timeline document. Every function returns a new document
 * (or null when the edit is not allowed: locked track, overlap, outside the media), so the editor can
 * keep snapshots for undo and the source files are never touched.
 */

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const end = (it: Pick<Item, "startFrame" | "durationFrames">) => it.startFrame + it.durationFrames;
export const toFrame = (sec: number, fps: number) => Math.round(sec * fps);
export const toSec = (frame: number, fps: number) => frame / fps;

/** Longest usable length of an item's media in timeline frames at speed 1 (null = no limit). */
export type MediaLimit = (it: Item) => number | null;

const trackOf = (doc: TimelineDoc, id: string) => doc.tracks.find((t) => t.id === id);
const lockedItem = (doc: TimelineDoc, it: Item) => trackOf(doc, it.trackId)?.locked ?? true;
export const itemsOn = (doc: TimelineDoc, trackId: string) => doc.items.filter((i) => i.trackId === trackId).sort((a, b) => a.startFrame - b.startFrame);

/** The main video track: the lowest VIDEO track. Subtitles and cards follow its items. */
export function mainTrack(doc: TimelineDoc): Track {
  return [...doc.tracks].filter((t) => t.type === "VIDEO").sort((a, b) => a.order - b.order)[0];
}

export function timelineEnd(doc: TimelineDoc) {
  return doc.items.reduce((a, i) => Math.max(a, end(i)), 0);
}

export function isFree(doc: TimelineDoc, trackId: string, start: number, dur: number, ignore: ReadonlySet<string> = new Set()) {
  if (start < 0 || dur < 1) return false;
  return !doc.items.some((i) => i.trackId === trackId && !ignore.has(i.id) && start < end(i) && i.startFrame < start + dur);
}

/** First free start at or after `from` on a track for an item of `dur` frames. */
export function freeSlot(doc: TimelineDoc, trackId: string, from: number, dur: number, ignore: ReadonlySet<string> = new Set()) {
  let at = Math.max(0, from);
  for (const i of itemsOn(doc, trackId)) {
    if (ignore.has(i.id)) continue;
    if (at + dur <= i.startFrame) break;
    if (end(i) > at) at = end(i);
  }
  return at;
}

const replace = (doc: TimelineDoc, items: Item[]): TimelineDoc => ({ ...doc, items });

/** Move items by `delta` frames, optionally onto another track (single item). Duration and source range are kept. */
export function move(doc: TimelineDoc, ids: string[], delta: number, targetTrackId?: string): TimelineDoc | null {
  const sel = doc.items.filter((i) => ids.includes(i.id));
  if (!sel.length || sel.some((i) => lockedItem(doc, i))) return null;
  const minStart = Math.min(...sel.map((i) => i.startFrame));
  const d = Math.max(delta, -minStart);
  const target = targetTrackId && sel.length === 1 ? trackOf(doc, targetTrackId) : undefined;
  if (targetTrackId && sel.length === 1 && (!target || target.locked || !TRACK_ACCEPTS[target.type].includes(sel[0].kind))) return null;
  const moved = new Map(sel.map((i) => [i.id, { ...i, startFrame: i.startFrame + d, trackId: target?.id ?? i.trackId }]));
  const next = doc.items.map((i) => moved.get(i.id) ?? i);
  for (const m of moved.values()) {
    const others = next.filter((i) => i.trackId === m.trackId && i.id !== m.id);
    if (others.some((o) => m.startFrame < end(o) && o.startFrame < end(m))) return null;
  }
  return replace(doc, next);
}

/** Move the left edge. The media under it stays put: sourceIn moves with the edge. */
export function trimStart(doc: TimelineDoc, id: string, newStart: number): TimelineDoc | null {
  const it = doc.items.find((i) => i.id === id);
  if (!it || lockedItem(doc, it)) return null;
  const delta = newStart - it.startFrame;
  const dur = it.durationFrames - delta;
  const media = it.kind === "video" || it.kind === "audio";
  const srcIn = it.sourceInFrame + Math.round(delta * it.speed);
  if (dur < 1 || newStart < 0 || (media && srcIn < 0)) return null;
  if (!isFree(doc, it.trackId, newStart, dur, new Set([id]))) return null;
  const keyframes = shiftKeyframes(it.keyframes, -delta, dur);
  return replace(doc, doc.items.map((i) => (i.id === id ? { ...i, startFrame: newStart, durationFrames: dur, sourceInFrame: media ? srcIn : i.sourceInFrame, keyframes } : i)));
}

/** Move the right edge, never past the end of the media. */
export function trimEnd(doc: TimelineDoc, id: string, newEnd: number, limit: MediaLimit): TimelineDoc | null {
  const it = doc.items.find((i) => i.id === id);
  if (!it || lockedItem(doc, it)) return null;
  const dur = newEnd - it.startFrame;
  if (dur < 1) return null;
  const max = limit(it);
  if (max !== null && it.sourceInFrame + Math.round(dur * it.speed) > max) return null;
  if (!isFree(doc, it.trackId, it.startFrame, dur, new Set([id]))) return null;
  return replace(doc, doc.items.map((i) => (i.id === id ? { ...i, durationFrames: dur, keyframes: i.keyframes.filter((k) => k.frame <= dur) } : i)));
}

function shiftKeyframes(kfs: Keyframe[], by: number, dur: number): Keyframe[] {
  if (!kfs.length || by === 0) return kfs;
  const out: Keyframe[] = [];
  for (const p of KF_PROPS) {
    const list = kfs.filter((k) => k.prop === p).sort((a, b) => a.frame - b.frame);
    if (!list.length) continue;
    const at = -by; // old local frame that becomes 0
    const kept = list.map((k) => ({ ...k, frame: k.frame + by })).filter((k) => k.frame >= 0 && k.frame <= dur);
    if (!kept.some((k) => k.frame === 0) && at > 0) out.push({ prop: p, frame: 0, value: valueAt(list, at, list[0].value), ease: "linear" });
    out.push(...kept);
  }
  return out;
}

/** Split items at a frame. Without ids, splits the main-track item under the frame. Nothing is lost: both halves keep their source range. */
export function split(doc: TimelineDoc, frame: number, ids?: string[]): { doc: TimelineDoc; created: string[] } | null {
  const main = mainTrack(doc);
  const targets = doc.items.filter((i) => (ids?.length ? ids.includes(i.id) : i.trackId === main.id) && i.startFrame < frame && frame < end(i) && !lockedItem(doc, i));
  if (!targets.length) return null;
  const created: string[] = [];
  let items = doc.items;
  for (const it of targets) {
    const cut = frame - it.startFrame;
    const media = it.kind === "video" || it.kind === "audio";
    const leftKf: Keyframe[] = [];
    const rightKf: Keyframe[] = [];
    for (const p of KF_PROPS) {
      const list = it.keyframes.filter((k) => k.prop === p).sort((a, b) => a.frame - b.frame);
      if (!list.length) continue;
      const v = valueAt(list, cut, list[0].value);
      leftKf.push(...list.filter((k) => k.frame < cut), { prop: p, frame: cut, value: v, ease: "linear" });
      rightKf.push({ prop: p, frame: 0, value: v, ease: list.filter((k) => k.frame < cut).pop()?.ease ?? "linear" }, ...list.filter((k) => k.frame > cut).map((k) => ({ ...k, frame: k.frame - cut })));
    }
    const fx = it.effects;
    const left: Item = { ...it, durationFrames: cut, keyframes: leftKf, effects: fx ? { ...fx, fadeOut: 0 } : fx };
    const right: Item = {
      ...it,
      id: newId(),
      startFrame: frame,
      durationFrames: it.durationFrames - cut,
      sourceInFrame: media ? it.sourceInFrame + Math.round(cut * it.speed) : it.sourceInFrame,
      keyframes: rightKf,
      effects: fx ? { ...fx, fadeIn: 0 } : fx,
    };
    created.push(right.id);
    items = items.flatMap((i) => (i.id === it.id ? [left, right] : [i]));
  }
  return { doc: replace(doc, items), created };
}

/** Copy items into the first free space after each original on the same track, with all settings. */
export function duplicate(doc: TimelineDoc, ids: string[]): { doc: TimelineDoc; created: string[] } | null {
  let next = doc;
  const created: string[] = [];
  for (const it of doc.items.filter((i) => ids.includes(i.id))) {
    if (lockedItem(doc, it)) continue;
    const at = freeSlot(next, it.trackId, end(it), it.durationFrames);
    const copy: Item = { ...it, id: newId(), startFrame: at, keyframes: it.keyframes.map((k) => ({ ...k })), transform: it.transform ? { ...it.transform, crop: { ...it.transform.crop } } : null };
    next = replace(next, [...next.items, copy]);
    created.push(copy.id);
  }
  return created.length ? { doc: next, created } : null;
}

/** Delete items. With ripple, later items on the same track close the gap. */
export function remove(doc: TimelineDoc, ids: string[], ripple = false): TimelineDoc | null {
  const gone = doc.items.filter((i) => ids.includes(i.id) && !lockedItem(doc, i));
  if (!gone.length) return null;
  const goneIds = new Set(gone.map((i) => i.id));
  let items = doc.items.filter((i) => !goneIds.has(i.id));
  if (ripple) {
    items = items.map((i) => {
      const shift = gone.filter((g) => g.trackId === i.trackId && end(g) <= i.startFrame).reduce((a, g) => a + g.durationFrames, 0);
      return shift ? { ...i, startFrame: i.startFrame - shift } : i;
    });
  }
  return replace(doc, items);
}

/** Add an item at `at` (or the next free spot). Returns null for a locked or incompatible track. */
export function addItem(doc: TimelineDoc, item: Omit<Item, "id" | "startFrame"> & { id?: string }, at: number): { doc: TimelineDoc; id: string } | null {
  const tr = trackOf(doc, item.trackId);
  if (!tr || tr.locked || !TRACK_ACCEPTS[tr.type].includes(item.kind)) return null;
  const start = freeSlot(doc, tr.id, at, item.durationFrames);
  const full: Item = { ...item, id: item.id ?? newId(), startFrame: start };
  return { doc: replace(doc, [...doc.items, full]), id: full.id };
}

export function updateItem(doc: TimelineDoc, id: string, patch: Partial<Omit<Item, "id" | "trackId" | "startFrame" | "durationFrames" | "sourceInFrame">>): TimelineDoc | null {
  const it = doc.items.find((i) => i.id === id);
  if (!it || lockedItem(doc, it)) return null;
  return replace(doc, doc.items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

/**
 * Cut source ranges (e.g. silences, in source seconds) out of every item of one media on a track and
 * close the gaps. Used by "Cut silences": the cut is non-destructive, just more, shorter items.
 */
export function cutRanges(doc: TimelineDoc, trackId: string, ref: { sourceVideoId: string }, ranges: Array<{ start: number; end: number }>, minPieceFrames = 3): TimelineDoc | null {
  const tr = trackOf(doc, trackId);
  if (!tr || tr.locked || !ranges.length) return null;
  const fps = doc.fps;
  const cutF = ranges.map((r) => ({ a: Math.round(r.start * fps), b: Math.round(r.end * fps) })).filter((r) => r.b > r.a).sort((x, y) => x.a - y.a);
  let shift = 0;
  let changed = false;
  const out: Item[] = [];
  for (const it of itemsOn(doc, trackId)) {
    const start = it.startFrame - shift;
    if (it.sourceVideoId !== ref.sourceVideoId || it.speed !== 1 || it.kind !== "video") {
      out.push({ ...it, startFrame: start });
      continue;
    }
    const s0 = it.sourceInFrame;
    const s1 = it.sourceInFrame + it.durationFrames;
    const pieces: Array<[number, number]> = [];
    let cur = s0;
    for (const c of cutF) {
      if (c.b <= cur || c.a >= s1) continue;
      if (c.a > cur) pieces.push([cur, c.a]);
      cur = Math.max(cur, c.b);
    }
    if (cur < s1) pieces.push([cur, s1]);
    const kept = pieces.filter(([a, b]) => b - a >= minPieceFrames);
    const keptLen = kept.reduce((a, [x, y]) => a + (y - x), 0);
    if (keptLen === it.durationFrames) { out.push({ ...it, startFrame: start }); continue; }
    changed = true;
    let at = start;
    kept.forEach(([a, b], k) => {
      out.push({ ...it, id: k === 0 ? it.id : newId(), startFrame: at, durationFrames: b - a, sourceInFrame: a, keyframes: [] });
      at += b - a;
    });
    shift += it.durationFrames - keptLen;
  }
  if (!changed) return null;
  return replace(doc, [...doc.items.filter((i) => i.trackId !== trackId), ...out]);
}

// ---------- tracks ----------

const ORDER_BASE: Record<TrackType, number> = { VIDEO: 0, BROLL: 100, OVERLAY: 200, TEXT: 300, EFFECTS: 400, AUDIO: 500, SUBTITLE: 600, CARDS: 700 };
export const TRACK_LABEL: Record<TrackType, string> = { VIDEO: "Video", AUDIO: "Audio", SUBTITLE: "Subtitles", TEXT: "Text", OVERLAY: "Overlay", BROLL: "B-roll", EFFECTS: "Effects", CARDS: "Cards" };

export function addTrack(doc: TimelineDoc, type: TrackType): { doc: TimelineDoc; id: string } | null {
  if (type === "SUBTITLE" || type === "CARDS") return null; // one each, they draw existing data
  const same = doc.tracks.filter((t) => t.type === type);
  const order = Math.max(ORDER_BASE[type], ...same.map((t) => t.order + 1));
  const t: Track = { id: newId(), name: `${TRACK_LABEL[type]} ${same.length + 1}`, type, order, hidden: false, muted: false, locked: false, volume: 1 };
  return { doc: { ...doc, tracks: [...doc.tracks, t] }, id: t.id };
}

export function removeTrack(doc: TimelineDoc, id: string): TimelineDoc | null {
  const t = trackOf(doc, id);
  if (!t || t.locked || t.type === "SUBTITLE" || t.type === "CARDS" || doc.items.some((i) => i.trackId === id) || t.id === mainTrack(doc).id) return null;
  return { ...doc, tracks: doc.tracks.filter((x) => x.id !== id) };
}

export function setTrack(doc: TimelineDoc, id: string, patch: Partial<Pick<Track, "hidden" | "muted" | "locked" | "volume" | "name">>): TimelineDoc {
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function defaultTracks(): Track[] {
  const mk = (type: TrackType): Track => ({ id: newId(), name: TRACK_LABEL[type], type, order: ORDER_BASE[type], hidden: false, muted: false, locked: false, volume: 1 });
  return (["CARDS", "SUBTITLE", "TEXT", "EFFECTS", "OVERLAY", "BROLL", "VIDEO", "AUDIO"] as const).map(mk);
}

// ---------- markers ----------

export function addMarker(doc: TimelineDoc, frame: number, label = ""): { doc: TimelineDoc; id: string } {
  const m: Marker = { id: newId(), frame: Math.max(0, frame), label, color: "#FF7A1A" };
  return { doc: { ...doc, markers: [...doc.markers, m].sort((a, b) => a.frame - b.frame) }, id: m.id };
}
export const updateMarker = (doc: TimelineDoc, id: string, patch: Partial<Omit<Marker, "id">>): TimelineDoc => ({ ...doc, markers: doc.markers.map((m) => (m.id === id ? { ...m, ...patch, frame: Math.max(0, patch.frame ?? m.frame) } : m)).sort((a, b) => a.frame - b.frame) });
export const removeMarker = (doc: TimelineDoc, id: string): TimelineDoc => ({ ...doc, markers: doc.markers.filter((m) => m.id !== id) });

// ---------- snapping ----------

/** Edges of all items (except the ones being dragged), markers, the playhead and any extra points. */
export function snapPoints(doc: TimelineDoc, exclude: ReadonlySet<string>, extra: number[] = []): number[] {
  const pts = new Set<number>([0, ...extra]);
  for (const i of doc.items) if (!exclude.has(i.id)) { pts.add(i.startFrame); pts.add(end(i)); }
  for (const m of doc.markers) pts.add(m.frame);
  return [...pts].sort((a, b) => a - b);
}

export function snap(frame: number, points: number[], threshold: number): number {
  let best = frame;
  let d = threshold + 1;
  for (const p of points) {
    const dd = Math.abs(p - frame);
    if (dd <= threshold && dd < d) { d = dd; best = p; }
  }
  return best;
}
