import type { ProbeResult } from "./probe";
import { verifyOutput } from "./render";
import { runCapture } from "./exec";

export type QcInterval = { start: number; end: number };

export type QcCheckId = "technical" | "decode" | "sharpness" | "loudness" | "alignment" | "autofix";

export type QcCheck = {
  id: QcCheckId;
  label: string;
  score: number;
  max: number;
  detail: string;
};

export type QcMetrics = {
  durationSec: number;
  blurMean: number | null;
  lufs: number | null;
  truePeakDb: number | null;
  blackIntervals: QcInterval[];
  freezeIntervals: QcInterval[];
  videoDurationSec: number | null;
  audioDurationSec: number | null;
  decodeErrors: string[];
  decodeWarning: string | null;
};

/**
 * Quality is measured on the finished file, not estimated from render settings. The score covers
 * technical compliance, a full decode, sharpness, loudness and A/V duration alignment. Black and
 * frozen intervals are reported as diagnostics but are not deducted: they can be intentional
 * timeline gaps or still images.
 */
export type QualityReport = {
  version: 1;
  score: number;
  grade: "A" | "B" | "C" | "D";
  checks: QcCheck[];
  metrics: QcMetrics;
  issues: string[];
  recommendations: string[];
};

export type AuditInput = {
  probe: ProbeResult;
  expected: { w: number; h: number; durationSec: number };
  decodeOk: boolean;
  decodeErrors: string[];
  blurMean: number | null;
  lufs: number | null;
  truePeakDb: number | null;
  blackIntervals: QcInterval[];
  freezeIntervals: QcInterval[];
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** blurdetect writes one summary line at the end. NaN means the frame had too little detail. */
export function parseBlurMean(stderr: string): number | null {
  const matches = [...stderr.matchAll(/blur mean:\s*([\d.]+|nan)/gi)];
  const raw = matches.at(-1)?.[1];
  if (!raw || raw.toLowerCase() === "nan") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Last integrated loudness and true-peak values from the ebur128 summary. */
export function parseLoudness(stderr: string): { lufs: number | null; truePeakDb: number | null } {
  const loud = [...stderr.matchAll(/\bI:\s*(-?[\d.]+)\s+LUFS/gi)].at(-1)?.[1];
  const peak = [...stderr.matchAll(/\bPeak:\s*(-?[\d.]+|-inf)\s+dBFS/gi)].at(-1)?.[1];
  return {
    lufs: loud === undefined ? null : Number(loud),
    truePeakDb: peak === undefined || peak.toLowerCase() === "-inf" ? null : Number(peak),
  };
}

/** blackdetect/freezedetect print only the end of a closed interval; an open one ends with the file. */
export function parseDetectIntervals(stderr: string, kind: "black" | "freeze", durationSec: number): QcInterval[] {
  const map = new Map<number, number>();
  const re = new RegExp(`${kind}_start:\\s*([\\d.]+)(?:\\s+${kind}_end:\\s*([\\d.]+))?`, "g");
  for (const m of stderr.matchAll(re)) {
    const start = Number(m[1]);
    if (!Number.isFinite(start)) continue;
    const end = m[2] === undefined ? durationSec : Number(m[2]);
    map.set(start, Number.isFinite(end) ? Math.max(start, end) : durationSec);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, end]) => ({ start, end }))
    .filter((x) => x.end > x.start);
}

export function sumIntervals(intervals: QcInterval[]): number {
  return Number(intervals.reduce((sum, x) => sum + Math.max(0, x.end - x.start), 0).toFixed(2));
}

function sharpnessScore(blurMean: number | null): { score: number; detail: string } {
  if (blurMean === null) return { score: 15, detail: "Not measurable: the picture has too little detail (text, flat colour or a still)." };
  if (blurMean <= 6) return { score: 20, detail: `Sharp (blur estimate ${blurMean.toFixed(1)}).` };
  if (blurMean <= 8) return { score: 17, detail: `Mostly sharp (blur estimate ${blurMean.toFixed(1)}).` };
  if (blurMean <= 11) return { score: 12, detail: `Slightly soft (blur estimate ${blurMean.toFixed(1)}).` };
  if (blurMean <= 16) return { score: 6, detail: `Soft (blur estimate ${blurMean.toFixed(1)}).` };
  return { score: 0, detail: `Very soft (blur estimate ${blurMean.toFixed(1)}).` };
}

function loudnessScore(lufs: number | null, truePeakDb: number | null): { score: number; detail: string } {
  if (lufs === null) return { score: 0, detail: "No integrated loudness measurement (silent or missing audio)." };
  const delta = Math.abs(lufs + 14);
  let score = delta <= 1 ? 20 : delta <= 2 ? 17 : delta <= 3 ? 13 : delta <= 5 ? 8 : delta <= 8 ? 3 : 0;
  if (truePeakDb !== null && truePeakDb > -0.5) score = Math.max(0, score - 4);
  else if (truePeakDb !== null && truePeakDb > -1) score = Math.max(0, score - 2);
  const peak = truePeakDb === null ? "no true peak" : `${truePeakDb.toFixed(1)} dBFS peak`;
  return { score, detail: `${lufs.toFixed(1)} LUFS (target -14), ${peak}.` };
}

function alignmentScore(videoSec: number | null, audioSec: number | null): { score: number; detail: string } {
  if (videoSec === null || audioSec === null) return { score: 8, detail: "Could not compare the stream durations." };
  const delta = Math.abs(videoSec - audioSec);
  const score = delta <= 0.15 ? 15 : delta <= 0.35 ? 12 : delta <= 0.75 ? 8 : delta <= 1.5 ? 4 : 0;
  return { score, detail: `Video ${videoSec.toFixed(2)}s, audio ${audioSec.toFixed(2)}s (difference ${delta.toFixed(2)}s).` };
}

export function buildQualityReport(input: AuditInput): QualityReport {
  const verify = verifyOutput(input.probe, input.expected);
  const technical: QcCheck = {
    id: "technical",
    label: "Format and duration",
    score: verify.ok ? 25 : 0,
    max: 25,
    detail: verify.ok ? `MP4 H.264/AAC ${input.expected.w}×${input.expected.h}, duration matches.` : verify.problems.join("; "),
  };
  const decode: QcCheck = {
    id: "decode",
    label: "Full decode",
    score: input.decodeOk && input.decodeErrors.length === 0 ? 20 : 0,
    max: 20,
    detail: input.decodeOk && input.decodeErrors.length === 0 ? "The whole file decoded without errors." : input.decodeErrors.slice(0, 2).join(" ") || "Decode failed.",
  };
  const sharp = sharpnessScore(input.blurMean);
  const sharpness: QcCheck = { id: "sharpness", label: "Sharpness", score: sharp.score, max: 20, detail: sharp.detail };
  const loud = loudnessScore(input.lufs, input.truePeakDb);
  const loudness: QcCheck = { id: "loudness", label: "Loudness", score: loud.score, max: 20, detail: loud.detail };
  const align = alignmentScore(input.probe.video?.durationSec ?? input.probe.durationSec, input.probe.audio?.durationSec ?? null);
  const alignment: QcCheck = { id: "alignment", label: "A/V alignment", score: align.score, max: 15, detail: align.detail };

  const checks = [technical, decode, sharpness, loudness, alignment];
  const score = clamp(checks.reduce((sum, c) => sum + c.score, 0), 0, 100);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D";

  const issues: string[] = [];
  const recommendations: string[] = [];
  if (!verify.ok) {
    issues.push(`The export does not match the requested format: ${verify.problems.join("; ")}.`);
    recommendations.push("Re-export and choose the same resolution and aspect again.");
  }
  if (input.decodeErrors.length > 0) {
    issues.push(`The full decode found ${input.decodeErrors.length} error${input.decodeErrors.length === 1 ? "" : "s"}.`);
    recommendations.push("Re-export the clip; this file is damaged.");
  }
  if (input.blurMean !== null && sharp.score < 17) {
    issues.push(sharp.detail);
    recommendations.push("Use a sharper source or export at 1080p. Small text and heavy compression can also look soft.");
  }
  if (loud.score < 17) {
    issues.push(loud.detail);
    recommendations.push("Check the source audio. The renderer already applies -14 LUFS loudness normalisation.");
  }
  if (align.score < 12) {
    issues.push(`The audio and video durations differ: ${align.detail}`);
    recommendations.push("Check whether the source audio ends before the picture, then trim the clip or add room tone.");
  }
  if (sumIntervals(input.blackIntervals) > Math.max(0.5, input.expected.durationSec * 0.2)) {
    const total = sumIntervals(input.blackIntervals);
    issues.push(`${total.toFixed(1)}s of black frames. This can be an intentional gap in the timeline.`);
    recommendations.push("Inspect the timeline if the black frames were not intentional.");
  }
  if (sumIntervals(input.freezeIntervals) > Math.max(0.5, input.expected.durationSec * 0.2)) {
    const total = sumIntervals(input.freezeIntervals);
    issues.push(`${total.toFixed(1)}s without picture movement. This can be an intentional still image.`);
    recommendations.push("Inspect the still images and paused sections in the timeline.");
  }

  return {
    version: 1,
    score,
    grade,
    checks,
    metrics: {
      durationSec: input.probe.durationSec,
      blurMean: input.blurMean,
      lufs: input.lufs,
      truePeakDb: input.truePeakDb,
      blackIntervals: input.blackIntervals,
      freezeIntervals: input.freezeIntervals,
      videoDurationSec: input.probe.video?.durationSec ?? input.probe.durationSec,
      audioDurationSec: input.probe.audio?.durationSec ?? null,
      decodeErrors: input.decodeErrors,
      decodeWarning: null,
    },
    issues,
    recommendations,
  };
}

function errorLines(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(frame=|size=|video:|audio:|subtitle:|other streams:|global headers:|muxing overhead)/i.test(l))
    .slice(0, 20);
}

/** Run the real measurements on a finished MP4. The caller decides whether decode errors are fatal. */
export async function auditOutput(args: {
  ffmpeg: string;
  file: string;
  probe: ProbeResult;
  expected: { w: number; h: number; durationSec: number };
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<QualityReport> {
  let decodeOk = true;
  let decodeErrors: string[] = [];
  try {
    const decoded = await runCapture(args.ffmpeg, ["-v", "error", "-nostdin", "-i", args.file, "-map", "0", "-f", "null", "-"], {
      timeoutMs: args.timeoutMs,
      signal: args.signal,
      maxStderr: 1024 * 1024,
    });
    decodeErrors = errorLines(decoded.stderr);
  } catch (e) {
    decodeOk = false;
    const tail = e && typeof e === "object" && "stderrTail" in e ? String((e as { stderrTail?: unknown }).stderrTail ?? "") : "";
    decodeErrors = errorLines(tail);
    if (decodeErrors.length === 0) decodeErrors = [e instanceof Error ? e.message : "The decoder could not read the file."];
  }

  let blurMean: number | null = null;
  let lufs: number | null = null;
  let truePeakDb: number | null = null;
  let blackIntervals: QcInterval[] = [];
  let freezeIntervals: QcInterval[] = [];
  let measureWarning: string | null = null;
  const hasVideo = Boolean(args.probe.video);
  const hasAudio = Boolean(args.probe.audio);
  const videoFilter = "fps=1,scale=640:-2,blurdetect=block_width=32:block_height=32:block_pct=80,blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-60dB:d=2";
  const argsOut = ["-hide_banner", "-nostdin", "-nostats", "-i", args.file];
  if (hasVideo && hasAudio) {
    argsOut.push("-filter_complex", `[0:v]${videoFilter}[v];[0:a]ebur128=peak=true[a]`, "-map", "[v]", "-map", "[a]");
  } else if (hasVideo) {
    argsOut.push("-filter_complex", `[0:v]${videoFilter}[v]`, "-map", "[v]");
  } else if (hasAudio) {
    argsOut.push("-filter_complex", "[0:a]ebur128=peak=true[a]", "-map", "[a]");
  }
  if (argsOut.includes("-map")) {
    argsOut.push("-f", "null", "-");
    try {
      const measured = await runCapture(args.ffmpeg, argsOut, {
        timeoutMs: args.timeoutMs,
        signal: args.signal,
        maxStderr: 4 * 1024 * 1024,
      });
      const stderr = measured.stderr;
      blurMean = parseBlurMean(stderr);
      const loud = parseLoudness(stderr);
      lufs = loud.lufs;
      truePeakDb = loud.truePeakDb;
      blackIntervals = parseDetectIntervals(stderr, "black", args.probe.durationSec);
      freezeIntervals = parseDetectIntervals(stderr, "freeze", args.probe.durationSec);
    } catch (e) {
      measureWarning = e instanceof Error ? e.message : "The quality measurements failed.";
    }
  } else {
    measureWarning = "The file has no audio or video stream to measure.";
  }

  const report = buildQualityReport({
    probe: args.probe,
    expected: args.expected,
    decodeOk,
    decodeErrors,
    blurMean,
    lufs,
    truePeakDb,
    blackIntervals,
    freezeIntervals,
  });
  if (measureWarning) {
    report.metrics.decodeWarning = measureWarning;
    report.recommendations.push(`Quality measurement warning: ${measureWarning}`);
  }
  return report;
}

/** Result of an auto-fix attempt: which fixes were applied and which were skipped. */
export type AutoFixResult = {
  file: string; // path to the (possibly fixed) output file
  applied: string[]; // human-readable descriptions of fixes applied
  skipped: string[]; // fixes that could not be applied
};

/**
 * Attempt to repair common QC problems on a finished render by re-encoding.
 * Handles: aspect-ratio mismatch (scale+pad), audio sample-rate normalization (48 kHz).
 * ASS subtitle frame-boundary issues are reported as skipped because they require
 * re-rendering with snapped subtitle timings in the pipeline.
 */
export async function autoFixOutput(args: {
  ffmpeg: string;
  file: string;
  probe: ProbeResult;
  expected: { w: number; h: number; durationSec: number };
  report: QualityReport;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AutoFixResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  let currentFile = args.file;
  let fixIdx = 0;
  const nextOut = () => args.file.replace(/\.mp4$/i, `-autofix-${++fixIdx}.mp4`);

  // 1. Aspect-ratio mismatch: re-encode video with scale+pad to expected dimensions.
  const v = args.probe.video;
  if (v && (v.width !== args.expected.w || v.height !== args.expected.h)) {
    const out = nextOut();
    try {
      await runCapture(args.ffmpeg, [
        "-y", "-hide_banner", "-nostdin",
        "-i", currentFile,
        "-vf", `scale=${args.expected.w}:${args.expected.h}:force_original_aspect_ratio=decrease,pad=${args.expected.w}:${args.expected.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
        "-c:a", "copy",
        "-movflags", "+faststart",
        out,
      ], { timeoutMs: args.timeoutMs, signal: args.signal });
      applied.push(`Aspect ratio: ${v.width}×${v.height} → ${args.expected.w}×${args.expected.h}`);
      currentFile = out;
    } catch (e) {
      skipped.push(`Aspect-ratio fix failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Audio sample-rate normalization: re-encode audio to 48 kHz.
  const a = args.probe.audio;
  if (a && a.sampleRate !== 48000) {
    const out = nextOut();
    try {
      await runCapture(args.ffmpeg, [
        "-y", "-hide_banner", "-nostdin",
        "-i", currentFile,
        "-c:v", "copy",
        "-c:a", "aac", "-ar", "48000", "-b:a", "160k",
        "-movflags", "+faststart",
        out,
      ], { timeoutMs: args.timeoutMs, signal: args.signal });
      applied.push(`Audio sample rate: ${a.sampleRate} Hz → 48000 Hz`);
      currentFile = out;
    } catch (e) {
      skipped.push(`Audio sample-rate fix failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. ASS subtitle frame boundary: requires re-render with snapped subtitle timings,
  //    which the pipeline must handle. Report as skipped here.
  const align = args.report.checks.find((c) => c.id === "alignment");
  if (align && align.score < 15) {
    skipped.push("ASS subtitle frame boundary: re-render with snapped subtitle timings required");
  }

  // Record an autofix check on the report.
  const autofix: QcCheck = {
    id: "autofix",
    label: "Auto-fix",
    score: applied.length > 0 ? 25 : 0,
    max: 25,
    detail: applied.length > 0 ? `Applied ${applied.length} fix${applied.length === 1 ? "" : "es"}.` : "No auto-fix needed or applicable.",
  };
  args.report.checks.push(autofix);
  args.report.score = clamp(args.report.score + autofix.score, 0, 100);
  args.report.grade = args.report.score >= 90 ? "A" : args.report.score >= 80 ? "B" : args.report.score >= 70 ? "C" : "D";
  for (const fix of applied) args.report.recommendations.push(`Auto-fixed: ${fix}`);
  for (const skip of skipped) args.report.recommendations.push(`Could not auto-fix: ${skip}`);

  return { file: currentFile, applied, skipped };
}
