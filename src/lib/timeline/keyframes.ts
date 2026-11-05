import type { Keyframe, KfProp } from "./schema";

/**
 * Keyframe maths shared by the preview (valueAt) and the renderer (kfExpr), so both compute the same
 * curve. Frames are item-local timeline frames. "ease" eases out of a keyframe into the next one
 * with smoothstep (3u² − 2u³); "linear" is a straight line.
 */
export const forProp = (kfs: Keyframe[], prop: KfProp) => kfs.filter((k) => k.prop === prop).sort((a, b) => a.frame - b.frame);

const ease = (u: number) => u * u * (3 - 2 * u);

export function valueAt(list: Keyframe[], frame: number, base: number): number {
  if (!list.length) return base;
  if (frame <= list[0].frame) return list[0].value;
  for (let k = 1; k < list.length; k++) {
    const a = list[k - 1];
    const b = list[k];
    if (frame <= b.frame) {
      const span = b.frame - a.frame;
      const u = span > 0 ? (frame - a.frame) / span : 1;
      return a.value + (b.value - a.value) * (a.ease === "ease" ? ease(u) : u);
    }
  }
  return list[list.length - 1].value;
}

export const propValue = (kfs: Keyframe[], prop: KfProp, frame: number, base: number) => valueAt(forProp(kfs, prop), frame, base);

const n = (x: number) => Number(x.toFixed(5)).toString();

/**
 * FFmpeg expression of the same curve over time variable `tv` (seconds on the output timeline).
 * `startSec` is where the item starts; keyframe frames are converted with `fps`.
 */
export function kfExpr(list: Keyframe[], base: number, fps: number, startSec: number, tv = "t"): string {
  if (!list.length) return n(base);
  const at = (k: Keyframe) => startSec + k.frame / fps;
  let expr = n(list[list.length - 1].value);
  for (let k = list.length - 1; k >= 1; k--) {
    const a = list[k - 1];
    const b = list[k];
    const span = at(b) - at(a);
    const u = span > 0 ? `((${tv}-${n(at(a))})/${n(span)})` : "1";
    const curve = a.ease === "ease" ? `(${u}*${u}*(3-2*${u}))` : u;
    expr = `if(lt(${tv},${n(at(b))}),${n(a.value)}+(${n(b.value - a.value)})*${curve},${expr})`;
  }
  return `if(lt(${tv},${n(at(list[0]))}),${n(list[0].value)},${expr})`;
}
