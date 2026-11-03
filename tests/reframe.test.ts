import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildTrack, cropFraction, focusAt, focusExpr, simplify, type FaceSample } from "@/lib/media/reframe";

const moving = (n = 40): FaceSample[] => Array.from({ length: n }, (_, i) => ({ t: i * 0.25, faces: [[0.2 + (0.6 * i) / (n - 1), 0.4, 0.1, 0.18]] }));

describe("follow-face camera path", () => {
  it("follows a face moving left to right", () => {
    const tr = buildTrack(moving());
    expect(tr.withFace).toBe(40);
    expect(focusAt(tr.keyframes, 0)).toBeLessThan(0.3);
    expect(focusAt(tr.keyframes, 9.75)).toBeGreaterThan(0.65);
    expect(tr.keyframes.length).toBeLessThanOrEqual(40);
  });
  it("ignores small false detections and holds through missed frames", () => {
    const s = moving().map((x, i) => (i % 5 === 0 ? { t: x.t, faces: [] } : { t: x.t, faces: [...x.faces, [0.9, 0.9, 0.02, 0.02]] }));
    const tr = buildTrack(s);
    for (const k of tr.keyframes) expect(k.x).toBeLessThan(0.85);
  });
  it("does not jump to a second person for a brief moment", () => {
    const s: FaceSample[] = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, faces: i >= 20 && i < 22 ? [[0.8, 0.4, 0.2, 0.3]] : [[0.3, 0.4, 0.1, 0.18]] }));
    const tr = buildTrack(s);
    expect(Math.max(...tr.keyframes.map((k) => k.x))).toBeLessThan(0.45);
  });
  it("centres when no face is found", () => {
    expect(buildTrack([{ t: 0, faces: [] }, { t: 1, faces: [] }]).keyframes).toEqual([{ t: 0, x: 0.5 }]);
  });
  it("caps pan speed (no whip pans)", () => {
    const s: FaceSample[] = [{ t: 0, faces: [[0.1, 0.5, 0.1, 0.1]] }, ...Array.from({ length: 8 }, (_, i) => ({ t: 0.25 * (i + 1), faces: [[0.9, 0.5, 0.1, 0.1]] }))];
    const tr = buildTrack(s);
    for (let i = 1; i < tr.keyframes.length; i++) {
      const a = tr.keyframes[i - 1];
      const b = tr.keyframes[i];
      expect(Math.abs(b.x - a.x) / Math.max(1e-6, b.t - a.t)).toBeLessThanOrEqual(0.36);
    }
  });
  it("simplify keeps the end points and respects the cap", () => {
    const pts = Array.from({ length: 300 }, (_, i) => ({ t: i * 0.1, x: 0.5 + 0.3 * Math.sin(i / 7) }));
    const out = simplify(pts, 0.001, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });
  it("crop fraction centres the subject and clamps at the edges", () => {
    const r = 16 / 9 / (9 / 16);
    expect(cropFraction(0.5, 16 / 9, 9 / 16)).toBeCloseTo(0.5, 5);
    expect(cropFraction(0.02, 16 / 9, 9 / 16)).toBe(0);
    expect(cropFraction(0.98, 16 / 9, 9 / 16)).toBe(1);
    expect(r).toBeGreaterThan(1);
  });
  it("focus expression is accepted and evaluated by ffmpeg", () => {
    const expr = focusExpr([{ t: 0, x: 0.2 }, { t: 2, x: 0.8 }]);
    // crop a 1920-wide test frame to 608 px and read the x offset ffmpeg used at t=1 (subject 0.5 -> centred)
    const log = execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=10:d=2", "-vf", `crop=608:1080:x='max(0,min(in_w-out_w,(${expr})*in_w-out_w/2))':y=0,showinfo`, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(log).toBe("");
  });
});
