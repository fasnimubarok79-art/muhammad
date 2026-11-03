import type { Interval } from "./clipping";
import type { Word } from "./subtitles";

export type Aspect = "9:16" | "16:9" | "1:1";
export type Framing = "blur" | "crop" | "pad" | "follow";
export type PresetId = "cinematic_podcast" | "viral_short" | "educational" | "storytelling" | "clean_professional";
export type Resolution = "450p" | "720p" | "1080p";

export type Preset = {
  id: PresetId;
  label: string;
  subtitle: "karaoke" | "pop" | "clean";
  zoom: number; // total zoom gained over the clip, 0 = none
  eq: { contrast: number; saturation: number; brightness: number; gamma: number };
  warm: number; // 0..0.1 colour balance toward warm highlights
  sharpen: number; // unsharp luma amount, 0 = off
  fade: number; // seconds
};

export const PRESETS: Record<PresetId, Preset> = {
  cinematic_podcast: { id: "cinematic_podcast", label: "Cinematic Podcast", subtitle: "clean", zoom: 0.05, eq: { contrast: 1.06, saturation: 1.05, brightness: 0, gamma: 0.98 }, warm: 0.03, sharpen: 0.35, fade: 0.3 },
  viral_short: { id: "viral_short", label: "Viral Short", subtitle: "karaoke", zoom: 0.1, eq: { contrast: 1.1, saturation: 1.15, brightness: 0.01, gamma: 1 }, warm: 0.02, sharpen: 0.45, fade: 0.2 },
  educational: { id: "educational", label: "Educational", subtitle: "clean", zoom: 0, eq: { contrast: 1.02, saturation: 1.0, brightness: 0.01, gamma: 1 }, warm: 0, sharpen: 0.3, fade: 0.25 },
  storytelling: { id: "storytelling", label: "Storytelling", subtitle: "karaoke", zoom: 0.06, eq: { contrast: 1.05, saturation: 0.95, brightness: -0.01, gamma: 0.97 }, warm: 0.05, sharpen: 0.3, fade: 0.5 },
  clean_professional: { id: "clean_professional", label: "Clean Professional", subtitle: "clean", zoom: 0, eq: { contrast: 1.0, saturation: 1.0, brightness: 0, gamma: 1 }, warm: 0, sharpen: 0, fade: 0.2 },
};

export function outputSize(aspect: Aspect, res: Resolution) {
  const short = res === "1080p" ? 1080 : res === "720p" ? 720 : 450;
  const long = Math.round((short * 16) / 9 / 2) * 2;
  if (aspect === "9:16") return { w: short, h: long };
  if (aspect === "16:9") return { w: long, h: short };
  return { w: short, h: short };
}

/** Intervals of the clip to keep after removing silences longer than `minGap` (clip-relative). */
export function keepIntervals(duration: number, silences: Interval[], minGap = 0.6, pad = 0.12): Interval[] {
  const cuts = silences
    .filter((s) => s.end - s.start >= minGap)
    .map((s) => ({ start: Math.max(0, s.start + pad), end: Math.min(duration, s.end - pad) }))
    .filter((s) => s.end - s.start > 0.05)
    .sort((a, b) => a.start - b.start);
  const keep: Interval[] = [];
  let t = 0;
  for (const c of cuts) {
    if (c.start > t) keep.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (t < duration) keep.push({ start: t, end: duration });
  return keep.filter((k) => k.end - k.start > 0.08);
}

/** Map a time in the original clip to the edited timeline; null if it was cut. */
export function mapTime(t: number, keep: Interval[]): number | null {
  let acc = 0;
  for (const k of keep) {
    if (t < k.start) return acc;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return acc;
}

export function remapWords(words: Word[], keep: Interval[]): Word[] {
  return words
    .map((w) => {
      const s = mapTime(w.s, keep);
      const e = mapTime(w.e, keep);
      return s === null || e === null ? null : { ...w, s, e: Math.max(e, s + 0.05) };
    })
    .filter((w): w is Word => w !== null);
}

/** Escape a path for use as a filter option value inside -filter_complex. */
export function filterPath(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export type RenderPlan = {
  input: string;
  clipStart: number;
  clipEnd: number;
  srcFps: number;
  hasAudio: boolean;
  aspect: Aspect;
  resolution: Resolution;
  framing: Framing;
  cropX: number; // 0..1 horizontal focus for crop framing
  focusExpr?: string; // follow framing: FFmpeg expression of the subject centre (0..1) over output time t
  preset: Preset;
  keep: Interval[]; // clip-relative intervals to keep (whole clip when no silence removal)
  assPath?: string;
  fontsDir?: string;
  output: string;
};

const f = (n: number) => Number(n.toFixed(3)).toString();

/** Build the ffmpeg argument list. Only filters verified on the target ffmpeg build are used. */
export function buildRenderArgs(p: RenderPlan): string[] {
  const { w: OW, h: OH } = outputSize(p.aspect, p.resolution);
  const dur = p.keep.reduce((a, k) => a + (k.end - k.start), 0);
  const fps = p.srcFps > 0 && p.srcFps <= 60 ? p.srcFps : 30;
  const chains: string[] = [];

  // 1. cut: trim the kept intervals and join them
  const n = p.keep.length;
  p.keep.forEach((k, i) => {
    chains.push(`[0:v]trim=start=${f(k.start)}:end=${f(k.end)},setpts=PTS-STARTPTS[v${i}]`);
    if (p.hasAudio) chains.push(`[0:a]atrim=start=${f(k.start)}:end=${f(k.end)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  if (n > 1) {
    const ins = p.keep.map((_, i) => (p.hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
    chains.push(`${ins}concat=n=${n}:v=1:a=${p.hasAudio ? 1 : 0}${p.hasAudio ? "[vc][ac]" : "[vc]"}`);
  } else {
    chains.push(`[v0]null[vc]`);
    if (p.hasAudio) chains.push(`[a0]anull[ac]`);
  }

  // 2. framing: never stretch; cover+crop, blurred fill, or letterbox
  const cover = `scale=${OW}:${OH}:force_original_aspect_ratio=increase`;
  const contain = `scale=${OW}:${OH}:force_original_aspect_ratio=decrease`;
  if (p.framing === "follow") {
    // keep the tracked subject centred; clamp so the crop never leaves the frame
    const fx = p.focusExpr ?? "0.5";
    chains.push(`[vc]${cover},crop=${OW}:${OH}:x='max(0,min(in_w-out_w,(${fx})*in_w-out_w/2))':y='(in_h-out_h)/2'[vf]`);
  } else if (p.framing === "crop") {
    chains.push(`[vc]${cover},crop=${OW}:${OH}:x='(in_w-out_w)*${f(Math.min(1, Math.max(0, p.cropX)))}':y='(in_h-out_h)/2'[vf]`);
  } else if (p.framing === "pad") {
    chains.push(`[vc]${contain},pad=${OW}:${OH}:(ow-iw)/2:(oh-ih)/2:color=black[vf]`);
  } else {
    chains.push(`[vc]split=2[bgsrc][fgsrc]`);
    chains.push(`[bgsrc]${cover},crop=${OW}:${OH},boxblur=luma_radius=24:luma_power=2,eq=brightness=-0.08:saturation=0.9[bg]`);
    chains.push(`[fgsrc]${contain}[fg]`);
    chains.push(`[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2[vf]`);
  }

  // 3. look: slow zoom, grade, sharpen, fades, subtitles, pixel format
  const look: string[] = [];
  if (p.preset.zoom > 0 && dur > 0) {
    const z = `(1+${f(p.preset.zoom)}*t/${f(dur)})`;
    look.push(`scale=w='2*trunc(${OW}*${z}/2)':h='2*trunc(${OH}*${z}/2)':eval=frame`, `crop=${OW}:${OH}`);
  }
  const e = p.preset.eq;
  look.push(`eq=contrast=${f(e.contrast)}:saturation=${f(e.saturation)}:brightness=${f(e.brightness)}:gamma=${f(e.gamma)}`);
  if (p.preset.warm > 0) look.push(`colorbalance=rh=${f(p.preset.warm)}:bh=${f(-p.preset.warm)}`);
  if (p.preset.sharpen > 0) look.push(`unsharp=5:5:${f(p.preset.sharpen)}:5:5:0`);
  const fade = Math.min(p.preset.fade, dur / 4);
  if (fade > 0) look.push(`fade=t=in:st=0:d=${f(fade)}`, `fade=t=out:st=${f(Math.max(0, dur - fade))}:d=${f(fade)}`);
  if (p.assPath) look.push(`ass=filename='${filterPath(p.assPath)}'${p.fontsDir ? `:fontsdir='${filterPath(p.fontsDir)}'` : ""}`);
  look.push(`fps=${f(fps)}`, "format=yuv420p");
  chains.push(`[vf]${look.join(",")}[vout]`);

  // 4. audio: clean low rumble, loudness for mobile playback, fades
  if (p.hasAudio) {
    const af = ["highpass=f=70", "loudnorm=I=-14:TP=-1.5:LRA=11"];
    if (fade > 0) af.push(`afade=t=in:st=0:d=${f(fade)}`, `afade=t=out:st=${f(Math.max(0, dur - fade))}:d=${f(fade)}`);
    af.push("aresample=48000");
    chains.push(`[ac]${af.join(",")}[aout]`);
  }

  const args = ["-hide_banner", "-nostdin", "-y", "-ss", f(p.clipStart), "-t", f(p.clipEnd - p.clipStart), "-i", p.input];
  if (!p.hasAudio) args.push("-f", "lavfi", "-t", f(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push("-filter_complex", chains.join(";"), "-map", "[vout]", "-map", p.hasAudio ? "[aout]" : "1:a");
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", p.resolution === "1080p" ? "20" : "22", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-t", f(dur), "-progress", "pipe:2", "-stats_period", "1",
    p.output,
  );
  return args;
}

export type OutputCheck = { ok: boolean; problems: string[] };

/** Verify a rendered file against the export spec using ffprobe output. */
export function verifyOutput(
  probe: { durationSec: number; formatName: string; video?: { codec: string; width: number; height: number; fps: number; pixFmt?: string }; audio?: { codec: string } },
  expect: { w: number; h: number; durationSec: number },
): OutputCheck {
  const problems: string[] = [];
  if (!probe.formatName.includes("mp4")) problems.push(`container is ${probe.formatName}, expected mp4`);
  if (probe.video?.codec !== "h264") problems.push(`video codec ${probe.video?.codec ?? "missing"}, expected h264`);
  if (probe.audio?.codec !== "aac") problems.push(`audio codec ${probe.audio?.codec ?? "missing"}, expected aac`);
  if (probe.video && (probe.video.width !== expect.w || probe.video.height !== expect.h)) problems.push(`size ${probe.video.width}x${probe.video.height}, expected ${expect.w}x${expect.h}`);
  if (probe.video?.pixFmt && probe.video.pixFmt !== "yuv420p") problems.push(`pixel format ${probe.video.pixFmt}`);
  if (Math.abs(probe.durationSec - expect.durationSec) > 0.5) problems.push(`duration ${probe.durationSec.toFixed(2)}s, expected ${expect.durationSec.toFixed(2)}s`);
  return { ok: problems.length === 0, problems };
}
