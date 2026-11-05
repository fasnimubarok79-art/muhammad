import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildRenderArgs, PRESETS } from "@/lib/media/render";
import { blankItem, defaultTimeline } from "@/lib/timeline/defaults";
import { addItem, mainTrack, setTrack } from "@/lib/timeline/ops";
import { planTimeline, type PlanMedia } from "@/lib/timeline/render-plan";
import { FFMPEG, FFPROBE, hasFfmpeg } from "./helpers/binaries";
const dir = mkdtempSync(path.join(os.tmpdir(), "ck-tl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** main: 6 s of the source at 2× (= 3 s), then a 1 s gap, then a 2 s still image; plus a muted audio track. */
function layout() {
  let doc = defaultTimeline({ clip: { startSec: 0, endSec: 6, sourceVideoId: "src" }, sourceDurationSec: 8, aspect: "9:16" });
  const fps = doc.fps;
  const main = mainTrack(doc);
  doc = { ...doc, items: doc.items.map((i) => ({ ...i, speed: 2, durationFrames: 3 * fps })) };
  doc = addItem(doc, { ...blankItem(main.id, "image", 2 * fps, { mediaAssetId: "img" }) }, 4 * fps)!.doc;
  const au = doc.tracks.find((t) => t.type === "AUDIO")!;
  doc = addItem(doc, { ...blankItem(au.id, "audio", 2 * fps, { mediaAssetId: "tone" }) }, 0)!.doc;
  doc = setTrack(doc, au.id, { muted: true });
  return doc;
}
const media = (): Map<string, PlanMedia> => new Map([
  ["source:src", { path: path.join(dir, "src.mp4"), kind: "VIDEO", durationSec: 8, width: 320, height: 180, hasAudio: true }],
  ["asset:img", { path: path.join(dir, "img.png"), kind: "IMAGE", durationSec: null, width: 64, height: 64, hasAudio: false }],
  ["asset:tone", { path: path.join(dir, "tone.wav"), kind: "AUDIO", durationSec: 3, width: 0, height: 0, hasAudio: true }],
]);

describe("timeline render plan", () => {
  it("speed, gap, still image and a muted track become the right pieces", () => {
    const plan = planTimeline(layout(), media());
    expect(plan.segments.map((s) => [s.input === null ? "gap" : plan.inputs[s.input].image ? "image" : "video", Number(s.dur.toFixed(3)), s.speed])).toEqual([["video", 3, 2], ["gap", 1, 1], ["image", 2, 1]]);
    expect(plan.durationSec).toBeCloseTo(6);
    expect(plan.audios).toHaveLength(0); // muted audio track
    const args = buildRenderArgs({ ...plan, fps: 30, aspect: "9:16", resolution: "450p", framing: "crop", cropX: 0.5, preset: PRESETS.clean_professional, output: path.join(dir, "out.mp4") });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("setpts=(PTS-STARTPTS)/2");
    expect(fc).toContain("atempo=2");
    expect(fc).toContain("color=c=black");
    expect(args).toContain("-loop");
  });

  it.skipIf(!hasFfmpeg)("renders it with ffmpeg: 6 s long, fast part, black gap, the image", () => {
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=8", "-f", "lavfi", "-i", "sine=frequency=500:duration=8", "-shortest", "-pix_fmt", "yuv420p", path.join(dir, "src.mp4")]);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0000FF:s=64x64", "-frames:v", "1", path.join(dir, "img.png")]);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=3", path.join(dir, "tone.wav")]);
    const out = path.join(dir, "out.mp4");
    const plan = planTimeline(layout(), media());
    const args = buildRenderArgs({ ...plan, fps: 30, aspect: "9:16", resolution: "450p", framing: "crop", cropX: 0.5, preset: PRESETS.clean_professional, output: out });
    execFileSync(FFMPEG, args, { stdio: "ignore" });
    const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }));
    expect(dur).toBeGreaterThan(5.9);
    expect(dur).toBeLessThan(6.15);
    const stat = (t: number, key: string) => Number(new RegExp(`${key}=([\\d.]+)`).exec(spawnSync(FFMPEG, ["-hide_banner", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", "signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1] ?? NaN);
    expect(stat(3.5, "YAVG")).toBeLessThan(20); // gap is black
    expect(stat(5, "VAVG")).toBeLessThan(120); // blue image (BT.601: U≈240, V≈110, neutral 128)
    expect(stat(5, "UAVG")).toBeGreaterThan(200);
  }, 60_000);
});
