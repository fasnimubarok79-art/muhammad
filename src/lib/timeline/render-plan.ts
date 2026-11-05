import type { AudioLayer, EffectRange, MainSegment, OverlayLayer, RenderInput } from "../media/render";
import { forProp, kfExpr } from "./keyframes";
import { end, itemsOn, mainTrack, timelineEnd } from "./ops";
import { mediaRef, type Item, type TimelineDoc, type Track } from "./schema";

/** What the renderer needs to know about each media file an item uses. */
export type PlanMedia = { path: string; kind: "VIDEO" | "AUDIO" | "IMAGE"; durationSec: number | null; width: number; height: number; hasAudio: boolean };

/**
 * Turn a timeline document into the compositor plan: main-track pieces (with black gaps), picture
 * layers, placed sounds, effect ranges and text items, using the same rules the Studio preview draws:
 * hidden tracks are not drawn, muted tracks are silent, higher `order` draws on top.
 */
export function planTimeline(doc: TimelineDoc, media: Map<string, PlanMedia>) {
  const fps = doc.fps;
  const sec = (fr: number) => fr / fps;
  const total = sec(timelineEnd(doc));
  const main = mainTrack(doc);
  const inputs: RenderInput[] = [];
  const index = new Map<string, number>();
  const uses = new Map<string, { a: number; b: number }>();

  const use = (it: Item) => {
    const ref = mediaRef(it);
    const m = media.get(ref);
    if (!m) throw new Error(`Media ${ref} is missing`);
    const a = sec(it.sourceInFrame);
    const b = m.kind === "IMAGE" ? sec(it.durationFrames) : sec(it.sourceInFrame) + sec(it.durationFrames) * it.speed;
    const u = uses.get(ref);
    uses.set(ref, u ? { a: Math.min(u.a, a), b: Math.max(u.b, b) } : { a, b });
    if (!index.has(ref)) {
      index.set(ref, inputs.length);
      inputs.push({ path: m.path, image: m.kind === "IMAGE", hasAudio: m.hasAudio, ss: 0, t: 0 });
    }
    return { k: index.get(ref)!, m, ref };
  };
  const trackVol = (t: Track) => (t.muted ? 0 : t.volume);
  const fx = (it: Item) => ({ fadeIn: sec(it.effects?.fadeIn ?? 0), fadeOut: sec(it.effects?.fadeOut ?? 0) });

  // main track pieces, gaps filled with black, padded to the full timeline length
  const segments: MainSegment[] = [];
  const segMeta: Array<{ item: Item | null; at: number }> = [];
  let cursor = 0;
  const pushGap = (to: number) => {
    if (to - cursor > 0.5 / fps) {
      segments.push({ input: null, start: 0, dur: to - cursor, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, mute: true });
      segMeta.push({ item: null, at: cursor });
    }
    cursor = Math.max(cursor, to);
  };
  const mainItems = itemsOn(doc, main.id);
  const pendingMain: Array<{ it: Item; k: number; m: PlanMedia }> = [];
  for (const it of mainItems) pendingMain.push({ it, ...use(it) });
  for (const { it, k, m } of pendingMain) {
    pushGap(sec(it.startFrame));
    const vol = it.volume * trackVol(main);
    const vk = forProp(it.keyframes, "volume");
    segments.push({
      input: k, blank: main.hidden, start: sec(it.sourceInFrame), dur: sec(it.durationFrames), speed: it.speed,
      volume: vol, volumeExpr: vk.length ? `(${kfExpr(vk, it.volume, fps, 0)})*${trackVol(main)}` : undefined,
      ...fx(it), mute: main.muted || !m.hasAudio || m.kind === "IMAGE", crop: it.transform?.crop,
    });
    segMeta.push({ item: it, at: sec(it.startFrame) });
    cursor = sec(end(it));
  }
  pushGap(total);
  if (!segments.length) throw new Error("The timeline is empty");

  // picture layers: B-roll, overlays and extra video tracks, bottom to top
  const overlays: OverlayLayer[] = [];
  const audios: AudioLayer[] = [];
  const layerTracks = doc.tracks.filter((t) => (t.type === "BROLL" || t.type === "OVERLAY" || t.type === "VIDEO") && t.id !== main.id).sort((a, b) => a.order - b.order);
  for (const tr of layerTracks) {
    for (const it of itemsOn(doc, tr.id)) {
      const { k, m } = use(it);
      const at = sec(it.startFrame);
      const tf = it.transform ?? { x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: "contain" as const, crop: { l: 0, t: 0, r: 0, b: 0 } };
      const kx = (p: "x" | "y" | "scale" | "opacity", base: number) => {
        const list = forProp(it.keyframes, p);
        return list.length ? kfExpr(list, base, fps, at) : undefined;
      };
      if (!tr.hidden) {
        overlays.push({
          input: k, image: m.kind === "IMAGE", start: sec(it.sourceInFrame), at, dur: sec(it.durationFrames), speed: it.speed,
          srcW: m.width, srcH: m.height, fit: tf.fit, x: tf.x, y: tf.y, scale: tf.scale, rotation: tf.rotation, opacity: it.opacity, crop: tf.crop,
          ...fx(it),
          exprs: { x: kx("x", tf.x), y: kx("y", tf.y), scale: kx("scale", tf.scale), opacity: kx("opacity", it.opacity) },
        });
      }
      if (m.kind === "VIDEO" && m.hasAudio && it.volume > 0 && trackVol(tr) > 0) {
        const vk = forProp(it.keyframes, "volume");
        audios.push({ input: k, start: sec(it.sourceInFrame), at, dur: sec(it.durationFrames), speed: it.speed, volume: it.volume * trackVol(tr), volumeExpr: vk.length ? `(${kfExpr(vk, it.volume, fps, at)})*${trackVol(tr)}` : undefined, ...fx(it) });
      }
    }
  }
  for (const tr of doc.tracks.filter((t) => t.type === "AUDIO")) {
    for (const it of itemsOn(doc, tr.id)) {
      const { k } = use(it);
      if (trackVol(tr) <= 0 || it.volume <= 0) continue;
      const at = sec(it.startFrame);
      const vk = forProp(it.keyframes, "volume");
      audios.push({ input: k, start: sec(it.sourceInFrame), at, dur: sec(it.durationFrames), speed: it.speed, volume: it.volume * trackVol(tr), volumeExpr: vk.length ? `(${kfExpr(vk, it.volume, fps, at)})*${trackVol(tr)}` : undefined, ...fx(it) });
    }
  }

  const effects: EffectRange[] = doc.tracks
    .filter((t) => t.type === "EFFECTS" && !t.hidden)
    .flatMap((t) => itemsOn(doc, t.id))
    .filter((i) => i.effects?.type)
    .map((i) => ({ type: i.effects!.type!, start: sec(i.startFrame), end: sec(end(i)), intensity: i.effects!.intensity ?? 0.5 }));

  const texts = doc.tracks
    .filter((t) => t.type === "TEXT" && !t.hidden)
    .flatMap((t) => itemsOn(doc, t.id))
    .map((i) => ({ ...i, startSec: sec(i.startFrame), durSec: sec(i.durationFrames) }));

  // pre-seek every input to the part that is used, with a little margin
  for (const [ref, k] of index) {
    const u = uses.get(ref)!;
    const inp = inputs[k];
    if (inp.image) { inp.t = u.b + 1; continue; }
    inp.ss = Math.max(0, u.a - 0.5);
    inp.t = u.b - inp.ss + 0.5;
  }
  for (const s of segments) if (s.input !== null && !inputs[s.input].image) s.start -= inputs[s.input].ss;
  for (const o of overlays) if (!o.image) o.start -= inputs[o.input].ss;
  for (const a of audios) a.start -= inputs[a.input].ss;

  return { inputs, segments, segMeta, overlays, audios, effects, texts, durationSec: segments.reduce((a, s) => a + s.dur, 0), mainTrack: main };
}
