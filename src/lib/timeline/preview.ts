import type { Segment } from "../media/subtitles";
import { propValue } from "./keyframes";
import type { Item } from "./schema";

/** Subtitle line and active word at time t (any time base, as long as segments use the same one). */
export function activeSubtitle<S extends Pick<Segment, "start" | "end" | "words">>(segments: S[], t: number) {
  const seg = segments.find((s) => t >= s.start && t < s.end);
  if (!seg) return null;
  const idx = seg.words.findIndex((w, i) => t >= w.s && (i === seg.words.length - 1 || t < seg.words[i + 1].s));
  return { seg, idx };
}

/**
 * Where a picture layer sits, as shares of the output frame, at an item-local frame. Same maths as the
 * renderer's overlay chain: crop, contain/cover fit to the frame, scale, centre at (x, y).
 */
export function layerBox(it: Item, srcW: number, srcH: number, outW: number, outH: number, localFrame: number) {
  const tf = it.transform ?? { x: 0.5, y: 0.5, scale: 1, rotation: 0, fit: "contain" as const, crop: { l: 0, t: 0, r: 0, b: 0 } };
  const cw = Math.max(1, srcW * (1 - tf.crop.l - tf.crop.r));
  const ch = Math.max(1, srcH * (1 - tf.crop.t - tf.crop.b));
  const fit = tf.fit === "cover" ? Math.max(outW / cw, outH / ch) : Math.min(outW / cw, outH / ch);
  const scale = propValue(it.keyframes, "scale", localFrame, tf.scale);
  return {
    x: propValue(it.keyframes, "x", localFrame, tf.x),
    y: propValue(it.keyframes, "y", localFrame, tf.y),
    w: (cw * fit * scale) / outW,
    h: (ch * fit * scale) / outH,
    rotation: tf.rotation,
    opacity: propValue(it.keyframes, "opacity", localFrame, it.opacity),
    crop: tf.crop,
  };
}

/** Fade multiplier (0..1) for an item at a local frame. */
export function fadeAt(it: Item, localFrame: number) {
  const fi = it.effects?.fadeIn ?? 0;
  const fo = it.effects?.fadeOut ?? 0;
  let v = 1;
  if (fi > 0 && localFrame < fi) v = Math.min(v, localFrame / fi);
  if (fo > 0 && localFrame > it.durationFrames - fo) v = Math.min(v, (it.durationFrames - localFrame) / fo);
  return Math.max(0, Math.min(1, v));
}
