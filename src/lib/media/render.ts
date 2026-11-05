import type { Interval } from "./clipping";
import type { Word } from "./subtitles";

export type Aspect = "9:16" | "16:9" | "1:1";
export type Framing = "blur" | "crop" | "pad" | "follow";
export type PresetId = "cinematic_punch" | "cinematic_podcast" | "viral_short" | "viral_spotlight" | "educational" | "storytelling" | "clean_professional";
export type Resolution = "450p" | "720p" | "1080p";

export type Preset = {
  id: PresetId;
  label: string;
  subtitle: "karaoke" | "pop" | "clean" | "impact" | "punch" | "hormozi";
  zoom: number; // total zoom gained over the clip, 0 = none
  eq: { contrast: number; saturation: number; brightness: number; gamma: number };
  warm: number; // 0..0.1 colour balance toward warm highlights
  sharpen: number; // unsharp luma amount, 0 = off
  fade: number; // seconds
  vignette?: boolean; // darken the edges of the final frame
  bgGrid?: boolean; // fit+blur: faint grid on the blurred background
  frameGlow?: boolean; // fit+blur: soft orange glow and thin outline around the video frame
  punchScale?: number; // hard punch-in zoom (e.g. 1.3) on alternating shots, switched on cut points
  flash?: boolean; // short brightness flash on each punch cut
};

export const PRESETS: Record<PresetId, Preset> = {
  cinematic_podcast: { id: "cinematic_podcast", label: "Cinematic Podcast", subtitle: "clean", zoom: 0.05, eq: { contrast: 1.06, saturation: 1.05, brightness: 0, gamma: 0.98 }, warm: 0.03, sharpen: 0.35, fade: 0.3 },
  viral_short: { id: "viral_short", label: "Viral Short", subtitle: "karaoke", zoom: 0.1, eq: { contrast: 1.1, saturation: 1.15, brightness: 0.01, gamma: 1 }, warm: 0.02, sharpen: 0.45, fade: 0.2 },
  educational: { id: "educational", label: "Educational", subtitle: "clean", zoom: 0, eq: { contrast: 1.02, saturation: 1.0, brightness: 0.01, gamma: 1 }, warm: 0, sharpen: 0.3, fade: 0.25 },
  storytelling: { id: "storytelling", label: "Storytelling", subtitle: "karaoke", zoom: 0.06, eq: { contrast: 1.05, saturation: 0.95, brightness: -0.01, gamma: 0.97 }, warm: 0.05, sharpen: 0.3, fade: 0.5 },
  cinematic_punch: { id: "cinematic_punch", label: "Cinematic Punch", subtitle: "punch", zoom: 0.04, eq: { contrast: 1.16, saturation: 1.06, brightness: -0.02, gamma: 0.94 }, warm: 0.06, sharpen: 0.45, fade: 0.15, vignette: true, punchScale: 1.3, flash: true },
  viral_spotlight: { id: "viral_spotlight", label: "Viral Spotlight", subtitle: "impact", zoom: 0.12, eq: { contrast: 1.12, saturation: 1.12, brightness: 0, gamma: 0.98 }, warm: 0.04, sharpen: 0.4, fade: 0.2, vignette: true, bgGrid: true, frameGlow: true },
  clean_professional: { id: "clean_professional", label: "Clean Professional", subtitle: "clean", zoom: 0, eq: { contrast: 1.0, saturation: 1.0, brightness: 0, gamma: 1 }, warm: 0, sharpen: 0, fade: 0.2 },
};

/**
 * Alternate wide and punched-in shots on sentence/segment starts, like a two-camera podcast edit:
 * a shot change at most every `minGap` seconds, a punched shot never longer than `maxHold`.
 */
export function punchPlan(segmentStarts: number[], dur: number, minGap = 1.6, maxHold = 3.2): Interval[] {
  const starts = [...segmentStarts, dur].filter((t) => t >= 0 && t <= dur).sort((a, b) => a - b);
  const out: Interval[] = [];
  let last = 0;
  let zoomed = false;
  let zoomStart = 0;
  for (const t of starts) {
    if (t - last < minGap) continue;
    if (zoomed) {
      out.push({ start: zoomStart, end: Math.min(t, zoomStart + maxHold) });
      zoomed = false;
    } else if (t < dur - minGap) {
      zoomed = true;
      zoomStart = t;
    }
    last = t;
  }
  if (zoomed) out.push({ start: zoomStart, end: Math.min(dur, zoomStart + maxHold) });
  return out.filter((iv) => iv.end - iv.start > 0.5);
}

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

export type Crop = { l: number; t: number; r: number; b: number };

/** One file fed to ffmpeg. Video/audio inputs are pre-seeked (`ss`) and cut to `t` seconds. */
export type RenderInput = { path: string; image?: boolean; hasAudio: boolean; ss: number; t: number };

/**
 * One piece of the main track, in timeline order. `input` null = black gap.
 * `start` is seconds inside the (pre-seeked) input; `dur` is seconds on the output timeline.
 * `blank` keeps the sound of the input but shows black (a hidden main track).
 * `focusExpr` and `volumeExpr` use segment-local time t (0 at the segment start).
 */
export type MainSegment = { input: number | null; blank?: boolean; start: number; dur: number; speed: number; volume: number; volumeExpr?: string; fadeIn: number; fadeOut: number; mute: boolean; focusExpr?: string; crop?: Crop };

/** A picture layer on top of the main track. Expressions use output time t. */
export type OverlayLayer = {
  input: number; image: boolean; start: number; at: number; dur: number; speed: number;
  srcW: number; srcH: number; fit: "contain" | "cover"; x: number; y: number; scale: number; rotation: number; opacity: number; crop?: Crop;
  fadeIn: number; fadeOut: number;
  exprs?: { x?: string; y?: string; scale?: string; opacity?: string };
};

/** A sound placed on the timeline (audio track items and overlay sound). Expressions use output time t. */
export type AudioLayer = { input: number; start: number; at: number; dur: number; speed: number; volume: number; volumeExpr?: string; fadeIn: number; fadeOut: number };

export type EffectRange = { type: "zoom" | "flash" | "bw" | "blur"; start: number; end: number; intensity: number };

/** Watermark image layer drawn over the entire render. */
export type WatermarkLayer = {
  input: number; x: number; y: number; scale: number; opacity: number;
};

export type RenderPlan = {
  aspect: Aspect;
  resolution: Resolution;
  framing: Framing;
  cropX: number; // 0..1 horizontal focus for crop framing
  preset: Preset;
  punchIntervals?: Interval[]; // output-time intervals shown punched in (preset.punchScale)
  assPath?: string;
  fontsDir?: string;
  output: string;
  fps?: number;
  // background styling for fit+blur framing
  bgColor?: string; // #RRGGBB fill for empty areas when framing is blur/pad
  // multi-track timeline
  inputs?: RenderInput[];
  segments?: MainSegment[];
  overlays?: OverlayLayer[];
  audios?: AudioLayer[];
  effects?: EffectRange[];
  watermarks?: WatermarkLayer[]; // drawn over everything below text
  // single clip (jobs queued before the timeline existed): one input, kept intervals
  input?: string;
  clipStart?: number;
  clipEnd?: number;
  srcFps?: number;
  hasAudio?: boolean;
  focusExpr?: string; // output time t over the kept intervals
  keep?: Interval[];
};

const f = (n: number) => Number(n.toFixed(3)).toString();

/** Re-express an output-time expression in a chain whose local time starts at `offset`. */
export const shiftT = (expr: string, offset: number) => (offset ? expr.replace(/\bt\b/g, `(t+${f(offset)})`) : expr);

function normalize(p: RenderPlan): { inputs: RenderInput[]; segments: MainSegment[]; fps: number } {
  const fps = p.fps ?? (p.srcFps && p.srcFps > 0 && p.srcFps <= 60 ? p.srcFps : 30);
  if (p.inputs && p.segments) return { inputs: p.inputs, segments: p.segments, fps };
  const keep = p.keep ?? [];
  let at = 0;
  const segments = keep.map((k) => {
    const s: MainSegment = { input: 0, start: k.start, dur: k.end - k.start, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, mute: !p.hasAudio, focusExpr: p.focusExpr ? shiftT(p.focusExpr, at) : undefined };
    at += k.end - k.start;
    return s;
  });
  return { inputs: [{ path: p.input ?? "", hasAudio: Boolean(p.hasAudio), ss: p.clipStart ?? 0, t: (p.clipEnd ?? 0) - (p.clipStart ?? 0) }], segments, fps };
}

const atempo = (speed: number) => {
  const out: string[] = [];
  let s = speed;
  while (s > 2) { out.push("atempo=2"); s /= 2; }
  while (s < 0.5) { out.push("atempo=0.5"); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${f(s)}`);
  return out;
};
const cropF = (c?: Crop) => (c && c.l + c.t + c.r + c.b > 0 ? [`crop=iw*${f(1 - c.l - c.r)}:ih*${f(1 - c.t - c.b)}:iw*${f(c.l)}:ih*${f(c.t)}`] : []);
const AFMT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

/** Build the ffmpeg argument list. Only filters verified on the target ffmpeg build are used. */
export function buildRenderArgs(p: RenderPlan): string[] {
  const { w: OW, h: OH } = outputSize(p.aspect, p.resolution);
  const { inputs, segments, fps } = normalize(p);
  const dur = segments.reduce((a, s) => a + s.dur, 0);
  const chains: string[] = [];
  const cover = `scale=${OW}:${OH}:force_original_aspect_ratio=increase`;
  const contain = `scale=${OW}:${OH}:force_original_aspect_ratio=decrease`;

  // 1. main track: every piece is cut, framed to the output size (never stretched) and joined
  segments.forEach((s, k) => {
    const inp = s.input === null ? null : inputs[s.input];
    const fin = `fps=${f(fps)},format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=0.2,trim=duration=${f(s.dur)},setpts=PTS-STARTPTS`;
    if (!inp || s.blank) {
      chains.push(`color=c=black:s=${OW}x${OH}:r=${f(fps)}:d=${f(s.dur)},${fin}[sv${k}]`);
    } else {
      const cut = inp.image
        ? `[${s.input}:v]trim=duration=${f(s.dur)},setpts=PTS-STARTPTS`
        : `[${s.input}:v]trim=start=${f(s.start)}:end=${f(s.start + s.dur * s.speed)},setpts=(PTS-STARTPTS)/${f(s.speed)}`;
      chains.push([cut, ...cropF(s.crop)].join(",") + `[c${k}]`);
      if (p.framing === "follow") {
        const fx = s.focusExpr ?? "0.5";
        chains.push(`[c${k}]${cover},crop=${OW}:${OH}:x='max(0,min(in_w-out_w,(${fx})*in_w-out_w/2))':y='(in_h-out_h)/2'[f${k}]`);
      } else if (p.framing === "crop") {
        chains.push(`[c${k}]${cover},crop=${OW}:${OH}:x='(in_w-out_w)*${f(Math.min(1, Math.max(0, p.cropX)))}':y='(in_h-out_h)/2'[f${k}]`);
      } else if (p.framing === "pad") {
        chains.push(`[c${k}]${contain},pad=${OW}:${OH}:(ow-iw)/2:(oh-ih)/2:color=${p.bgColor ?? "black"}[f${k}]`);
      } else {
        chains.push(`[c${k}]split=2[bgsrc${k}][fgsrc${k}]`);
        const grid = p.preset.bgGrid ? `,drawgrid=w=${Math.round(OW / 9)}:h=${Math.round(OW / 9)}:t=1:c=white@0.09` : "";
        const bgVignette = p.preset.bgGrid ? ",vignette=angle=PI/3.2" : "";
        chains.push(`[bgsrc${k}]${cover},crop=${OW}:${OH},boxblur=luma_radius=24:luma_power=2,eq=brightness=-0.12:saturation=0.85${grid}${bgVignette}[bg${k}]`);
        if (p.preset.frameGlow) {
          // glow: an orange box the size of the video on a black full frame, blurred, then blended with
          // "screen" (black leaves the background untouched), and the video placed on top with a thin outline
          const g = Math.round(OW * 0.03);
          const line = Math.max(2, Math.round(OW / 360));
          chains.push(`[fgsrc${k}]${contain},split=2[fgv${k}][fgm${k}]`);
          chains.push(`[fgm${k}]drawbox=x=0:y=0:w=iw:h=ih:color=0xFF7A1A:t=fill,pad=${OW}:${OH}:(ow-iw)/2:(oh-ih)/2:color=black,gblur=sigma=${g},format=gbrp[glow${k}]`);
          chains.push(`[fgv${k}]drawbox=x=0:y=0:w=iw:h=ih:color=0xFF7A1A@0.9:t=${line}[fg${k}]`);
          chains.push(`[bg${k}]format=gbrp[bgp${k}]`);
          chains.push(`[bgp${k}][glow${k}]blend=all_mode=screen:all_opacity=0.7,format=yuv420p[bgg${k}]`);
          chains.push(`[bgg${k}][fg${k}]overlay=x=(W-w)/2:y=(H-h)/2[f${k}]`);
        } else {
          chains.push(`[fgsrc${k}]${contain}[fg${k}]`);
          chains.push(`[bg${k}][fg${k}]overlay=x=(W-w)/2:y=(H-h)/2[f${k}]`);
        }
      }
      chains.push(`[f${k}]${fin}[sv${k}]`);
    }
    // sound of the piece (silence for gaps, images, muted tracks and files without audio)
    const pad = `${AFMT},apad=whole_dur=${f(s.dur)},atrim=duration=${f(s.dur)},asetpts=PTS-STARTPTS`;
    if (inp && !inp.image && inp.hasAudio && !s.mute) {
      const af = [`[${s.input}:a]atrim=start=${f(s.start)}:end=${f(s.start + s.dur * s.speed)}`, "asetpts=PTS-STARTPTS", ...atempo(s.speed)];
      if (s.volumeExpr) af.push(`volume='${s.volumeExpr}':eval=frame`);
      else if (s.volume !== 1) af.push(`volume=${f(s.volume)}`);
      if (s.fadeIn > 0) af.push(`afade=t=in:st=0:d=${f(Math.min(s.fadeIn, s.dur))}`);
      if (s.fadeOut > 0) af.push(`afade=t=out:st=${f(Math.max(0, s.dur - s.fadeOut))}:d=${f(Math.min(s.fadeOut, s.dur))}`);
      chains.push(`${af.join(",")},${pad}[sa${k}]`);
    } else {
      chains.push(`aevalsrc=0|0:c=stereo:s=48000:d=${f(s.dur)},${pad}[sa${k}]`);
    }
  });
  chains.push(`${segments.map((_, k) => `[sv${k}][sa${k}]`).join("")}concat=n=${segments.length}:v=1:a=1[vc][ac]`);

  // 2. look of the main picture: slow zoom, punch-ins, zoom effects, grade, sharpen, flashes
  const look: string[] = [];
  const punches = p.preset.punchScale && p.punchIntervals?.length ? p.punchIntervals : [];
  const zooms = (p.effects ?? []).filter((e) => e.type === "zoom" && e.end > e.start);
  if ((p.preset.zoom > 0 || punches.length || zooms.length) && dur > 0) {
    const on = punches.map((iv) => `between(t,${f(iv.start)},${f(iv.end)})`).join("+");
    const punch = punches.length ? `*(1+${f(p.preset.punchScale! - 1)}*min(1,${on}))` : "";
    const fx = zooms.map((e) => `*(1+${f(0.5 * e.intensity)}*between(t,${f(e.start)},${f(e.end)})*(t-${f(e.start)})/${f(e.end - e.start)})`).join("");
    const z = `(1+${f(p.preset.zoom)}*t/${f(dur)})${punch}${fx}`;
    look.push(`scale=w='2*trunc(${OW}*${z}/2)':h='2*trunc(${OH}*${z}/2)':eval=frame`, `crop=${OW}:${OH}`);
  }
  const e = p.preset.eq;
  look.push(`eq=contrast=${f(e.contrast)}:saturation=${f(e.saturation)}:brightness=${f(e.brightness)}:gamma=${f(e.gamma)}`);
  if (p.preset.warm > 0) look.push(`colorbalance=rh=${f(p.preset.warm)}:bh=${f(-p.preset.warm)}`);
  if (p.preset.sharpen > 0) look.push(`unsharp=5:5:${f(p.preset.sharpen)}:5:5:0`);
  if (p.preset.vignette && p.framing !== "blur") look.push("vignette=angle=PI/4.5");
  const flashes: string[] = [];
  if (p.preset.flash && punches.length) {
    // a 2-frame brightness flash at every punch in and out
    const cuts = punches.flatMap((iv) => [iv.start, iv.end]).filter((c) => c > 0.05 && c < dur - 0.05);
    flashes.push(...cuts.map((c) => `0.22*between(t,${f(c)},${f(c + 0.07)})`));
  }
  for (const fl of (p.effects ?? []).filter((x) => x.type === "flash")) flashes.push(`${f(0.15 + 0.45 * fl.intensity)}*between(t,${f(fl.start)},${f(Math.min(fl.end, fl.start + 0.12))})`);
  if (flashes.length) look.push(`eq=brightness='min(0.6,${flashes.join("+")})':eval=frame`);
  chains.push(`[vc]${look.join(",")}[v0]`);

  // 3. overlay and B-roll layers, bottom to top
  let base = "v0";
  (p.overlays ?? []).forEach((o, k) => {
    const cw = o.srcW * (1 - (o.crop?.l ?? 0) - (o.crop?.r ?? 0));
    const ch = o.srcH * (1 - (o.crop?.t ?? 0) - (o.crop?.b ?? 0));
    const fit = o.fit === "cover" ? Math.max(OW / cw, OH / ch) : Math.min(OW / cw, OH / ch);
    const sc = o.exprs?.scale ?? f(o.scale);
    const chain = [
      o.image ? `[${o.input}:v]trim=duration=${f(o.dur)},setpts=PTS-STARTPTS+${f(o.at)}/TB` : `[${o.input}:v]trim=start=${f(o.start)}:end=${f(o.start + o.dur * o.speed)},setpts=(PTS-STARTPTS)/${f(o.speed)}+${f(o.at)}/TB`,
      ...cropF(o.crop),
      `scale=w='max(2,trunc(iw*${f(fit)}*(${sc})/2)*2)':h='max(2,trunc(ih*${f(fit)}*(${sc})/2)*2)':eval=frame`,
      "format=rgba",
    ];
    if (o.rotation) chain.push(`rotate=a=${f((o.rotation * Math.PI) / 180)}:ow='rotw(${f((o.rotation * Math.PI) / 180)})':oh='roth(${f((o.rotation * Math.PI) / 180)})':c=none`);
    if (o.exprs?.opacity) chain.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${o.exprs.opacity.replace(/\bt\b/g, "T")},0,1)'`);
    else if (o.opacity < 1) chain.push(`colorchannelmixer=aa=${f(o.opacity)}`);
    if (o.fadeIn > 0) chain.push(`fade=t=in:st=${f(o.at)}:d=${f(Math.min(o.fadeIn, o.dur))}:alpha=1`);
    if (o.fadeOut > 0) chain.push(`fade=t=out:st=${f(o.at + Math.max(0, o.dur - o.fadeOut))}:d=${f(Math.min(o.fadeOut, o.dur))}:alpha=1`);
    chains.push(`${chain.join(",")}[o${k}]`);
    const x = o.exprs?.x ?? f(o.x);
    const y = o.exprs?.y ?? f(o.y);
    chains.push(`[${base}][o${k}]overlay=x='(${x})*W-w/2':y='(${y})*H-h/2':eval=frame:eof_action=pass:enable='between(t,${f(o.at)},${f(o.at + o.dur)})'[b${k}]`);
    base = `b${k}`;
  });

  // watermarks drawn over everything below text
  (p.watermarks ?? []).forEach((wm, k) => {
    chains.push(
      `[${wm.input}:v]trim=duration=${f(dur)},setpts=PTS-STARTPTS,scale=iw*${f(wm.scale)}:ih*${f(wm.scale)}:eval=frame,format=rgba,colorchannelmixer=aa=${f(wm.opacity)}[wm${k}]`,
    );
    chains.push(
      `[${base}][wm${k}]overlay=x='(${f(wm.x)})*W-w':y='(${f(wm.y)})*H-h':eval=frame:eof_action=pass[wmout${k}]`,
    );
    base = `wmout${k}`;
  });

  // 4. effects over everything below the text, then fades, burned-in text and the output format
  const tail: string[] = [];
  for (const x of (p.effects ?? []).filter((x) => x.type === "bw")) tail.push(`hue=s=0:enable='between(t,${f(x.start)},${f(x.end)})'`);
  for (const x of (p.effects ?? []).filter((x) => x.type === "blur")) tail.push(`gblur=sigma=${f(2 + 18 * x.intensity)}:enable='between(t,${f(x.start)},${f(x.end)})'`);
  const fade = Math.min(p.preset.fade, dur / 4);
  if (fade > 0) tail.push(`fade=t=in:st=0:d=${f(fade)}`, `fade=t=out:st=${f(Math.max(0, dur - fade))}:d=${f(fade)}`);
  if (p.assPath) tail.push(`ass=filename='${filterPath(p.assPath)}'${p.fontsDir ? `:fontsdir='${filterPath(p.fontsDir)}'` : ""}`);
  tail.push(`fps=${f(fps)}`, "format=yuv420p");
  chains.push(`[${base}]${tail.join(",")}[vout]`);

  // 5. audio: main track plus placed sounds, then rumble filter, loudness for phones, fades
  const extra = (p.audios ?? []).filter((a) => inputs[a.input]?.hasAudio);
  extra.forEach((a, k) => {
    const af = [`[${a.input}:a]atrim=start=${f(a.start)}:end=${f(a.start + a.dur * a.speed)}`, "asetpts=PTS-STARTPTS", ...atempo(a.speed)];
    if (a.fadeIn > 0) af.push(`afade=t=in:st=0:d=${f(Math.min(a.fadeIn, a.dur))}`);
    if (a.fadeOut > 0) af.push(`afade=t=out:st=${f(Math.max(0, a.dur - a.fadeOut))}:d=${f(Math.min(a.fadeOut, a.dur))}`);
    af.push(AFMT, `adelay=${Math.round(a.at * 1000)}:all=1`);
    if (a.volumeExpr) af.push(`volume='${a.volumeExpr}':eval=frame`);
    else if (a.volume !== 1) af.push(`volume=${f(a.volume)}`);
    chains.push(`${af.join(",")}[x${k}]`);
  });
  const mixed = extra.length ? `[ac]${extra.map((_, k) => `[x${k}]`).join("")}amix=inputs=${extra.length + 1}:duration=first:dropout_transition=0:normalize=0[am]` : "[ac]anull[am]";
  chains.push(mixed);
  const af = ["highpass=f=70", "loudnorm=I=-14:TP=-1.5:LRA=11"];
  if (fade > 0) af.push(`afade=t=in:st=0:d=${f(fade)}`, `afade=t=out:st=${f(Math.max(0, dur - fade))}:d=${f(fade)}`);
  af.push("aresample=48000");
  chains.push(`[am]${af.join(",")}[aout]`);

  const args = ["-hide_banner", "-nostdin", "-y"];
  for (const inp of inputs) {
    if (inp.image) args.push("-loop", "1", "-framerate", f(fps), "-t", f(inp.t), "-i", inp.path);
    else args.push("-ss", f(inp.ss), "-t", f(inp.t), "-i", inp.path);
  }
  args.push("-filter_complex", chains.join(";"), "-map", "[vout]", "-map", "[aout]");
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
