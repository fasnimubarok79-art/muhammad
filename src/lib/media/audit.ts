import type { ProbeResult } from "./probe";
import type { Word } from "./subtitles";

/**
 * Video audit report built only from measured data: a live ffprobe of the stored file, the
 * silencedetect/scdet results saved at analysis time, the Whisper words and the stored clip candidates.
 * Every section names its basis so nothing reads as more certain than it is.
 */
export type AuditInput = {
  source: {
    id: string; originalName: string | null; platform: string; sourceUrl: string | null; sizeBytes: number | null;
    durationSec: number | null; width: number | null; height: number | null; fps: number | null; hasAudio: boolean | null;
    analysis: unknown; createdAt: Date | string;
  };
  probe: ProbeResult | null;
  probeError?: string;
  transcript: { language: string | null; engine: string; words: Word[] } | null;
  clips: Array<{ id: string; title: string; startSec: number; endSec: number; score: number | null; hookScore: number | null; hookText: string | null; insights: unknown; segments: number }>;
};

type Interval = { start: number; end: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function aspectLabel(w: number, h: number) {
  if (!w || !h) return null;
  const g = gcd(w, h);
  const ratio = `${w / g}:${h / g}`;
  const known: Array<[number, string]> = [[9 / 16, "9:16"], [16 / 9, "16:9"], [1, "1:1"], [4 / 5, "4:5"], [4 / 3, "4:3"], [21 / 9, "21:9"]];
  const near = known.find(([v]) => Math.abs(w / h - v) < 0.02)?.[1];
  const shape = w > h ? "landscape" : w < h ? "portrait" : "square";
  return { ratio: near ?? ratio, exact: ratio, shape };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function buildAudit(i: AuditInput) {
  const p = i.probe;
  const dur = p?.durationSec || i.source.durationSec || 0;
  const w = p?.video?.width ?? i.source.width ?? 0;
  const h = p?.video?.height ?? i.source.height ?? 0;
  const analysis = (i.source.analysis ?? {}) as { silences?: Interval[]; scenes?: number[] };
  const silences = (analysis.silences ?? []).filter((s) => s.end > s.start);
  const scenes = (analysis.scenes ?? []).filter((t) => t > 0 && t < dur).sort((a, b) => a - b);
  const words = i.transcript?.words ?? [];
  const warnings: string[] = [];

  // file
  const file = {
    name: i.source.originalName ?? i.source.sourceUrl ?? i.source.platform,
    platform: i.source.platform,
    container: p?.formatName ?? null,
    sizeBytes: p?.sizeBytes || i.source.sizeBytes || null,
    durationSec: r2(dur),
    width: w || null,
    height: h || null,
    aspect: aspectLabel(w, h),
    fps: p?.video?.fps ? r2(p.video.fps) : i.source.fps ? r2(i.source.fps) : null,
    videoCodec: p?.video?.codec ?? null,
    pixelFormat: p?.video?.pixFmt ?? null,
    rotation: p?.video?.rotation ?? 0,
    audio: p ? (p.audio ? { codec: p.audio.codec, sampleRate: p.audio.sampleRate, channels: p.audio.channels } : null) : i.source.hasAudio ? { codec: null, sampleRate: null, channels: null } : null,
    basis: p ? "ffprobe of the stored file, run when this report was opened" : `Values saved at import. ${i.probeError ?? "The stored file could not be probed."}`,
  };
  if (!p) warnings.push(file.basis);
  if (w && h && Math.min(w, h) < 720) warnings.push(`The source is ${w}×${h}. A 1080×1920 export will be upscaled and look soft.`);
  if (p && !p.audio) warnings.push("The file has no audio track, so there is nothing to transcribe or caption.");

  // speech
  const timed = words.filter((x) => x.e > x.s);
  const speechSec = timed.reduce((a, x) => a + (x.e - x.s), 0);
  const scored = words.filter((x) => typeof x.p === "number" && x.p >= 0);
  const low = scored.filter((x) => (x.p as number) < 0.5);
  let longestGap = { start: 0, end: 0 };
  for (let k = 1; k < timed.length; k++) {
    if (timed[k].s - timed[k - 1].e > longestGap.end - longestGap.start) longestGap = { start: timed[k - 1].e, end: timed[k].s };
  }
  const speech = i.transcript
    ? {
        language: i.transcript.language,
        engine: i.transcript.engine,
        words: words.length,
        speechSec: r2(speechSec),
        speechShare: dur ? r2(speechSec / dur) : 0,
        wordsPerMinute: speechSec ? Math.round((words.length / dur) * 60) : 0,
        lowConfidenceWords: low.length,
        lowConfidenceShare: scored.length ? r2(low.length / scored.length) : null,
        lowConfidenceSample: low.slice(0, 12).map((x) => ({ w: x.w, t: r2(x.s), p: r2(x.p as number) })),
        medianWordSec: r2(median(timed.map((x) => x.e - x.s))),
        longestGap: { start: r2(longestGap.start), end: r2(longestGap.end), sec: r2(longestGap.end - longestGap.start) },
        basis: "Whisper word timestamps and per-word probability",
      }
    : null;
  if (!i.transcript) warnings.push("No transcript yet. Run the AI analysis to get speech, highlight and subtitle data.");
  if (speech?.lowConfidenceShare && speech.lowConfidenceShare > 0.15) warnings.push(`${Math.round(speech.lowConfidenceShare * 100)}% of words were heard with low confidence. Check the subtitles before export.`);

  // silences and scenes
  const silenceTotal = silences.reduce((a, s) => a + (s.end - s.start), 0);
  const longestSilence = silences.reduce<Interval | null>((a, s) => (!a || s.end - s.start > a.end - a.start ? s : a), null);
  const shots = [0, ...scenes, dur];
  const shotLens = shots.slice(1).map((t, k) => t - shots[k]).filter((x) => x > 0);

  // cut points: middle of every pause long enough to cut (same 0.6s rule as silence removal), plus scene changes
  const cutPoints = [
    ...silences.filter((s) => s.end - s.start >= 0.6).map((s) => ({ t: r2((s.start + s.end) / 2), kind: "pause" as const, sec: r2(s.end - s.start) })),
    ...scenes.map((t) => ({ t: r2(t), kind: "scene" as const, sec: 0 })),
  ].sort((a, b) => a.t - b.t);

  // B-roll candidates: long single shots with speech in them
  const broll: Array<{ start: number; end: number; sec: number; excerpt: string }> = [];
  for (let k = 1; k < shots.length; k++) {
    const a = shots[k - 1];
    const b = shots[k];
    if (b - a < 8) continue;
    const said = words.filter((x) => x.s >= a && x.e <= b);
    if (said.length < 5) continue;
    broll.push({ start: r2(a), end: r2(b), sec: r2(b - a), excerpt: said.slice(0, 14).map((x) => x.w).join(" ") + (said.length > 14 ? " ..." : "") });
  }

  // highlights: the stored candidates, best first
  const highlights = [...i.clips]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .map((c) => ({
      clipId: c.id,
      title: c.title,
      start: r2(c.startSec),
      end: r2(c.endSec),
      sec: r2(c.endSec - c.startSec),
      score: c.score,
      hookScore: c.hookScore,
      hook: c.hookText,
      why: (c.insights as { why?: string } | null)?.why ?? null,
      subtitleLines: c.segments,
    }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceId: i.source.id,
    file,
    speech,
    silences: { count: silences.length, totalSec: r2(silenceTotal), longest: longestSilence ? { start: r2(longestSilence.start), end: r2(longestSilence.end) } : null, basis: "ffmpeg silencedetect at analysis time (-35 dB, at least 0.5 s)" },
    scenes: { count: scenes.length, times: scenes.map(r2), averageShotSec: shotLens.length ? r2(shotLens.reduce((a, x) => a + x, 0) / shotLens.length) : r2(dur), basis: "ffmpeg scdet scene-change detection at analysis time (threshold 12)" },
    cutPoints: { count: cutPoints.length, points: cutPoints.slice(0, 60), basis: "Midpoints of pauses of 0.6 s or more, plus scene changes" },
    highlights: { count: highlights.length, clips: highlights, basis: "Stored clip candidates. Scores are estimates from transcript and pause features, not a promise of views" },
    broll: { count: broll.length, candidates: broll, basis: "Single shots of 8 s or more with speech in them, where an insert can break up a static frame. A timing heuristic, not visual understanding" },
    subtitles: { clipsWithSubtitles: i.clips.filter((c) => c.segments > 0).length, lines: i.clips.reduce((a, c) => a + c.segments, 0), basis: "Subtitle lines stored per clip" },
    warnings,
  };
}

export type AuditReport = ReturnType<typeof buildAudit>;
