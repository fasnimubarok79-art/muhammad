/**
 * Face-following reframe: turn sampled face detections into a smooth horizontal camera path.
 *
 * Rules, in order:
 * - the subject is the largest face; small detections (< 45% of the largest) are ignored as noise
 * - the subject only changes when another face wins for at least `switchAfter` seconds (no flicker)
 * - frames without a face hold the last position (people look down, turn, blink)
 * - a dead zone stops tiny movements; pan speed is capped so the camera never whips
 * - the path is simplified to a few keyframes for the renderer
 */

export type FaceSample = { t: number; faces: number[][] }; // [cx, cy, w, h] normalised
export type Keyframe = { t: number; x: number }; // x = subject centre, 0..1 of source width
export type FaceTrack = { keyframes: Keyframe[]; sampled: number; withFace: number; detector: string };

export const REFRAME = { deadZone: 0.05, settle: 0.008, maxSpeed: 0.35, switchAfter: 1.0, minRelSize: 0.45, smooth: 0.6, maxKeyframes: 40 };

function largest(faces: number[][]) {
  const big = Math.max(...faces.map((f) => f[2] * f[3]));
  return faces.filter((f) => f[2] * f[3] >= big * REFRAME.minRelSize);
}

export function buildTrack(samples: FaceSample[], detector = "unknown"): FaceTrack {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const withFace = sorted.filter((s) => s.faces.length).length;
  if (!withFace) return { keyframes: [{ t: 0, x: 0.5 }], sampled: sorted.length, withFace: 0, detector };

  // 1. raw subject position per sample, with hysteresis between candidates
  const raw: Keyframe[] = [];
  let current: number | null = null;
  let challenger: { x: number; since: number } | null = null;
  for (const s of sorted) {
    if (!s.faces.length) {
      if (current !== null) raw.push({ t: s.t, x: current });
      continue;
    }
    const cands = largest(s.faces);
    const best = cands.reduce((a, b) => (b[2] * b[3] > a[2] * a[3] ? b : a));
    if (current === null) current = best[0];
    else {
      const near = cands.reduce((a, b) => (Math.abs(b[0] - current!) < Math.abs(a[0] - current!) ? b : a));
      if (Math.abs(near[0] - current) < 0.12) {
        current = near[0]; // same person moved
        challenger = null;
      } else {
        // someone else: switch only after they persist
        if (!challenger || Math.abs(challenger.x - best[0]) > 0.12) challenger = { x: best[0], since: s.t };
        else if (s.t - challenger.since >= REFRAME.switchAfter) {
          current = best[0];
          challenger = null;
        }
      }
    }
    raw.push({ t: s.t, x: current });
  }
  // fill the start before the first detection with the first position
  if (raw.length && raw[0].t > 0) raw.unshift({ t: 0, x: raw[0].x });

  // 2. dead zone + exponential smoothing + speed limit
  // Hysteresis: the camera starts moving only when the subject leaves the dead zone, then keeps
  // following until the subject is centred again (a plain dead zone would leave a constant lag).
  const path: Keyframe[] = [];
  let cam = raw[0].x;
  let prevT = raw[0].t;
  let moving = false;
  for (const k of raw) {
    const dt = Math.max(0.001, k.t - prevT);
    const err = k.x - cam;
    if (!moving && Math.abs(err) > REFRAME.deadZone) moving = true;
    if (moving && Math.abs(err) < REFRAME.settle) moving = false;
    let target = moving ? k.x : cam;
    target = cam + (target - cam) * REFRAME.smooth;
    const maxStep = REFRAME.maxSpeed * dt;
    cam = Math.max(cam - maxStep, Math.min(cam + maxStep, target));
    path.push({ t: k.t, x: Number(cam.toFixed(4)) });
    prevT = k.t;
  }

  return { keyframes: simplify(path, 0.008, REFRAME.maxKeyframes), sampled: sorted.length, withFace, detector };
}

/** Ramer-Douglas-Peucker on (t, x); the tolerance grows until at most `max` keyframes remain. */
export function simplify(points: Keyframe[], eps: number, max: number): Keyframe[] {
  if (points.length <= 2) return points;
  const rdp = (pts: Keyframe[], e: number): Keyframe[] => {
    const a = pts[0];
    const b = pts[pts.length - 1];
    let idx = -1;
    let dmax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const xi = a.x + ((b.x - a.x) * (p.t - a.t)) / Math.max(1e-6, b.t - a.t);
      const d = Math.abs(p.x - xi);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax <= e || idx < 0) return [a, b];
    return [...rdp(pts.slice(0, idx + 1), e).slice(0, -1), ...rdp(pts.slice(idx), e)];
  };
  let e = eps;
  let out = rdp(points, e);
  for (let guard = 0; out.length > max && guard < 60; guard++) {
    e *= 1.6;
    out = rdp(points, e);
  }
  return out;
}

/** Subject centre at time t (linear between keyframes, held at the ends). Used by the editor preview. */
export function focusAt(kf: Keyframe[], t: number): number {
  if (!kf.length) return 0.5;
  if (t <= kf[0].t) return kf[0].x;
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i].t) {
      const a = kf[i - 1];
      const b = kf[i];
      return a.x + ((b.x - a.x) * (t - a.t)) / Math.max(1e-6, b.t - a.t);
    }
  }
  return kf[kf.length - 1].x;
}

const n = (v: number) => Number(v.toFixed(4)).toString();

/** FFmpeg expression for the subject centre as a function of t (piecewise linear). Must be used inside single quotes in the filter graph. */
export function focusExpr(kf: Keyframe[]): string {
  if (!kf.length) return "0.5";
  let expr = n(kf[kf.length - 1].x);
  for (let i = kf.length - 2; i >= 0; i--) {
    const a = kf[i];
    const b = kf[i + 1];
    const dt = Math.max(1e-3, b.t - a.t);
    expr = `if(lt(t,${n(b.t)}),${n(a.x)}+(${n(b.x - a.x)})*(t-${n(a.t)})/${n(dt)},${expr})`;
  }
  return `if(lt(t,${n(kf[0].t)}),${n(kf[0].x)},${expr})`;
}

/**
 * Crop offset for a cover-scaled frame so the subject centre sits in the middle, clamped to the frame.
 * Works for both the FFmpeg expression and the CSS object-position preview (same maths).
 */
export function cropFraction(centre: number, srcAspect: number, outAspect: number): number {
  const ratio = srcAspect / outAspect; // scaled source width / output width (>1 when cropping sideways)
  if (ratio <= 1) return 0.5;
  const x = (centre * ratio - 0.5) / (ratio - 1);
  return Math.max(0, Math.min(1, x));
}
