import path from "node:path";
import { env } from "../env";
import { run } from "./exec";
import { buildTrack, type FaceSample, type FaceTrack } from "./reframe";

export type CachedTrack = FaceTrack & { start: number; end: number };

/**
 * Run the OpenCV face sampler (worker/vision/faces.py) on [start, end) of a source file and turn the
 * detections into a smoothed camera path. Times in the result are relative to `start`.
 */
export async function detectFaceTrack(file: string, start: number, end: number, opts: { signal?: AbortSignal; onProgress?: (pct: number) => void } = {}): Promise<CachedTrack> {
  const script = path.resolve(process.cwd(), "worker", "vision", "faces.py");
  const sps = end - start > 120 ? 2 : 4;
  const out = await run(env().WHISPER_PYTHON, ["-I", script, file, start.toFixed(3), end.toFixed(3), String(sps)], {
    timeoutMs: 10 * 60_000,
    signal: opts.signal,
    onStderr: (l) => {
      const m = l.match(/^PROGRESS (\d+)/);
      if (m) opts.onProgress?.(Number(m[1]));
    },
  });
  const data = JSON.parse(out) as { detector: string; samples: FaceSample[] };
  return { ...buildTrack(data.samples, data.detector), start, end };
}

/** A cached track can be reused when it covers the whole window (e.g. the full clip, then trimmed). */
export const trackCovers = (t: unknown, start: number, end: number): t is CachedTrack => {
  const c = t as CachedTrack | null;
  return Boolean(c && Array.isArray(c.keyframes) && c.start <= start + 0.01 && c.end >= end - 0.01);
};

/** Re-base a cached track onto a window that starts later (times stay relative to the window). */
export function shiftTrack(c: CachedTrack, start: number, end: number): CachedTrack {
  const off = start - c.start;
  return { ...c, start, end, keyframes: c.keyframes.map((k) => ({ t: Math.max(0, k.t - off), x: k.x })) };
}
