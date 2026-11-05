import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { JobStatus, Prisma, RenderJob } from "@prisma/client";
import { db } from "../src/lib/db";
import { env } from "../src/lib/env";
import { ensureDirFor, keyPath, newKey } from "../src/lib/storage";
import { capture, refund } from "../src/lib/tokens";
import { safeRequest } from "../src/lib/url-safety";
import { buildYtDlpArgs, parseYtDlpOutput, parseYtDlpProgress, SOCIAL_PLATFORMS, ytDlpFriendlyError } from "../src/lib/media/ytdlp";
import { readdir, rename } from "node:fs/promises";
import { run, ProcessError } from "../src/lib/media/exec";
import { displaySize, probe } from "../src/lib/media/probe";
import { auditOutput, autoFixOutput, type AutoFixResult, type QualityReport } from "../src/lib/media/qc";
import { FEATURES } from "../config/features";
import { parseScenes, parseSilences, proposeClips, type Interval } from "../src/lib/media/clipping";
import { buildSegments, DEFAULT_STYLE, HORMOZI_STYLE, IMPACT_STYLE, PUNCH_STYLE, sliceWords, toAss, type Segment, type SubtitleStyle, type Word } from "../src/lib/media/subtitles";
import { cardEvents, CARD_STYLE_LINE, type WordCard } from "../src/lib/media/cards";
import { buildRenderArgs, outputSize, PRESETS, punchPlan, verifyOutput, type Aspect, type Framing, type PresetId, type Resolution } from "../src/lib/media/render";
import { defaultTimeline, pickFps } from "../src/lib/timeline/defaults";
import { mapCards, mapSegments } from "../src/lib/timeline/mapping";
import { planTimeline, type PlanMedia } from "../src/lib/timeline/render-plan";
import { timelineSchema, type TimelineDoc } from "../src/lib/timeline/schema";
import { checkRefs, rowsToDoc } from "../src/lib/timeline/store";
import { textEvents, TITLE_STYLE_LINE } from "../src/lib/timeline/text";
import { detectFaceTrack, shiftTrack, trackCovers, type CachedTrack } from "../src/lib/media/faces";
import { focusExpr as faceFocusExpr, type Keyframe } from "../src/lib/media/reframe";

export class JobCancelled extends Error {}

/** User-safe failure: message is shown in the dashboard. */
export class JobFailure extends Error {}

type Ctx = { job: RenderJob; signal: AbortSignal };

async function setStatus(ctx: Ctx, status: JobStatus, progress?: number) {
  const r = await db.renderJob.updateMany({
    where: { id: ctx.job.id, status: { notIn: ["cancelled", "failed", "completed"] } },
    data: { status, ...(progress !== undefined ? { progress } : {}), lockedAt: new Date() },
  });
  if (r.count === 0) throw new JobCancelled();
}

async function setProgress(jobId: string, progress: number) {
  await db.renderJob.updateMany({
    where: { id: jobId, status: { notIn: ["cancelled", "failed", "completed"] } },
    data: { progress: Math.max(0, Math.min(99, Math.round(progress))), lockedAt: new Date() },
  });
}

const ffmpeg = () => env().FFMPEG_PATH;
const ffprobe = () => env().FFPROBE_PATH;

// ---------------- ANALYZE ----------------

async function downloadSource(ctx: Ctx, sourceId: string, url: string, ownerId: string) {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  const res = await safeRequest(url, { method: "GET", timeoutMs: 30_000 });
  if (res.status < 200 || res.status >= 300) {
    res.stream.resume();
    throw new JobFailure(`The link returned HTTP ${res.status}`);
  }
  const type = String(res.headers["content-type"] ?? "").split(";")[0].trim();
  if (!type.startsWith("video/")) {
    res.stream.destroy();
    throw new JobFailure(`The link is not a video file (${type || "unknown type"})`);
  }
  const declared = Number(res.headers["content-length"] ?? 0);
  if (declared > maxBytes) {
    res.stream.destroy();
    throw new JobFailure(`File is larger than ${env().MAX_UPLOAD_MB} MB`);
  }
  const ext = type === "video/webm" ? "webm" : type === "video/quicktime" ? "mov" : "mp4";
  const key = newKey("sources", ownerId, ext);
  await ensureDirFor(key);
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) return cb(new JobFailure(`File is larger than ${env().MAX_UPLOAD_MB} MB`));
      if (declared > 0 && received % (4 * 1024 * 1024) < chunk.length) void setProgress(ctx.job.id, (received / declared) * 100 * 0.2);
      cb(null, chunk);
    },
  });
  try {
    await streamPipeline(res.stream, limiter, createWriteStream(keyPath(key)), { signal: ctx.signal });
  } catch (e) {
    await rm(keyPath(key), { force: true });
    throw e;
  }
  await db.sourceVideo.update({ where: { id: sourceId }, data: { storageKey: key, mimeType: type, sizeBytes: BigInt(received) } });
  return key;
}

/** Public social video via yt-dlp (platform extractors only, no cookies, no live, size and length limits). */
async function downloadSocial(ctx: Ctx, sourceId: string, url: string, ownerId: string) {
  const e = env();
  const tmpKey = newKey("sources", ownerId, "mp4");
  await ensureDirFor(tmpKey);
  const outBase = keyPath(tmpKey).replace(/\.mp4$/, "");
  const args = buildYtDlpArgs({
    url,
    outBase,
    ffmpegPath: e.FFMPEG_PATH,
    maxMb: e.MAX_UPLOAD_MB,
    maxMinutes: e.MAX_SOURCE_MINUTES,
    jsRuntime: e.YTDLP_JS_RUNTIME || undefined,
  });
  const onLine = (l: string) => {
    const p = parseYtDlpProgress(l);
    if (p !== null) void setProgress(ctx.job.id, 2 + p * 0.16);
  };
  let out: string;
  try {
    out = await run(e.YTDLP_PYTHON ?? e.WHISPER_PYTHON, args, { timeoutMs: e.JOB_TIMEOUT_MIN * 60_000, signal: ctx.signal, onStderr: onLine });
  } catch (err) {
    // remove partial files
    const dir = path.dirname(outBase);
    for (const f of await readdir(dir).catch(() => [] as string[])) if (f.startsWith(path.basename(outBase))) await rm(path.join(dir, f), { force: true });
    if (err instanceof ProcessError) {
      console.error("[worker] yt-dlp failed", err.stderrTail.slice(-800));
      throw new JobFailure(ytDlpFriendlyError(err.stderrTail));
    }
    throw err;
  }
  out.split(/\r?\n/).forEach(onLine);
  const r = parseYtDlpOutput(out, outBase);
  const ext = path.extname(r.filepath).slice(1).toLowerCase() || "mp4";
  let key = tmpKey;
  if (ext !== "mp4") {
    key = tmpKey.replace(/\.mp4$/, `.${ext}`);
    await rename(r.filepath, keyPath(key));
  } else if (r.filepath !== keyPath(tmpKey)) {
    await rename(r.filepath, keyPath(tmpKey));
  }
  const st = await stat(keyPath(key));
  await db.sourceVideo.update({
    where: { id: sourceId },
    data: {
      storageKey: key,
      mimeType: ext === "webm" ? "video/webm" : ext === "mkv" ? "video/x-matroska" : "video/mp4",
      sizeBytes: BigInt(st.size),
      originalName: (r.title ?? "").slice(0, 200) || null,
    },
  });
  return key;
}

export async function analyze(ctx: Ctx) {
  const job = ctx.job;
  await setStatus(ctx, "validating", 1);
  const src = await db.sourceVideo.findUnique({ where: { id: job.sourceVideoId! }, include: { project: true } });
  if (!src || src.project.userId !== job.userId) throw new JobFailure("Source video not found");
  if (src.accessState !== "PROCESSABLE") throw new JobFailure("This source is not processable");

  let key = src.storageKey;
  if (!key) {
    if (src.kind !== "URL" || !src.sourceUrl) throw new JobFailure("No media file for this source");
    await setStatus(ctx, "downloading", 2);
    key = SOCIAL_PLATFORMS.has(src.platform)
      ? await downloadSocial(ctx, src.id, src.sourceUrl, src.project.userId)
      : await downloadSource(ctx, src.id, src.sourceUrl, src.project.userId);
  }
  const file = keyPath(key);

  await setStatus(ctx, "analyzing", 20);
  let info;
  try {
    info = await probe(ffprobe(), file);
  } catch {
    throw new JobFailure("The file could not be read as a video");
  }
  if (!info.video) throw new JobFailure("The file has no video stream");
  if (!(info.durationSec > 0)) throw new JobFailure("The video has no readable duration");
  if (info.durationSec > env().MAX_SOURCE_MINUTES * 60) throw new JobFailure(`Videos longer than ${env().MAX_SOURCE_MINUTES} minutes are not accepted`);
  const size = displaySize(info.video);

  let silences: Interval[] = [];
  if (info.audio) {
    const lines: string[] = [];
    await run(ffmpeg(), ["-hide_banner", "-nostdin", "-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.5", "-f", "null", "-"], {
      timeoutMs: 20 * 60_000,
      signal: ctx.signal,
      onStderr: (l) => l.includes("silence_") && lines.push(l),
    });
    silences = parseSilences(lines.join("\n"), info.durationSec);
  }
  const sceneLines: string[] = [];
  await run(ffmpeg(), ["-hide_banner", "-nostdin", "-i", file, "-an", "-vf", "scale=320:-2,scdet=threshold=12", "-f", "null", "-"], {
    timeoutMs: 20 * 60_000,
    signal: ctx.signal,
    onStderr: (l) => l.includes("lavfi.scd.time") && sceneLines.push(l),
  });
  const scenes = parseScenes(sceneLines.join("\n"));

  await db.sourceVideo.update({
    where: { id: src.id },
    data: {
      durationSec: info.durationSec,
      width: size.w,
      height: size.h,
      fps: info.video.fps,
      hasAudio: Boolean(info.audio),
      analysis: { silences, scenes } as unknown as Prisma.InputJsonValue,
    },
  });
  await setProgress(job.id, 30);

  // transcription
  await setStatus(ctx, "transcribing", 30);
  let words: Word[] = [];
  let transcript: { language: string; text: string; words: Word[]; engine: string } | null = null;
  if (info.audio) {
    const tmp = path.join(os.tmpdir(), `ck-${job.id}.wav`);
    try {
      await run(ffmpeg(), ["-hide_banner", "-nostdin", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp], { timeoutMs: 20 * 60_000, signal: ctx.signal });
      const script = path.resolve(__dirname, "stt", "transcribe.py");
      const out = await run(env().WHISPER_PYTHON, ["-I", script, tmp, env().WHISPER_MODEL, env().WHISPER_LANGUAGE ?? ""], {
        timeoutMs: env().JOB_TIMEOUT_MIN * 60_000,
        signal: ctx.signal,
        onStderr: (l) => {
          const m = l.match(/^PROGRESS (\d+)/);
          if (m) void setProgress(job.id, 30 + Number(m[1]) * 0.55);
        },
      });
      transcript = JSON.parse(out);
      words = transcript!.words;
    } catch (e) {
      if (e instanceof ProcessError) {
        console.error("[worker] stt failed", e.message, e.stderrTail.slice(-600));
        throw new JobFailure("Speech recognition is not available on the server (Whisper failed). No transcript was invented.");
      }
      throw e;
    } finally {
      await rm(tmp, { force: true });
    }
    await db.transcript.upsert({
      where: { sourceVideoId: src.id },
      create: { sourceVideoId: src.id, language: transcript!.language, engine: transcript!.engine, text: transcript!.text, wordsJson: words as unknown as Prisma.InputJsonValue },
      update: { language: transcript!.language, engine: transcript!.engine, text: transcript!.text, wordsJson: words as unknown as Prisma.InputJsonValue },
    });
  }

  // clip candidates from the real transcript
  await setStatus(ctx, "editing", 86);
  const candidates = proposeClips(words, info.durationSec, silences);
  await db.$transaction(async (tx) => {
    await tx.clip.deleteMany({ where: { sourceVideoId: src.id, status: "candidate", favorite: false } });
    for (const c of candidates) {
      if (!(c.start >= 0 && c.end <= info.durationSec + 0.01 && c.end > c.start)) continue; // never outside the source
      const clipWords = sliceWords(words, c.start, c.end);
      const segs = buildSegments(clipWords);
      await tx.clip.create({
        data: {
          projectId: src.projectId,
          sourceVideoId: src.id,
          startSec: c.start,
          endSec: c.end,
          title: c.title,
          description: c.description,
          transcriptRef: c.transcriptRef,
          score: c.score,
          hookScore: c.hookScore,
          engagementScore: c.engagementScore,
          hookText: c.hookText,
          targetDuration: c.targetDuration,
          insights: c.insights as unknown as Prisma.InputJsonValue,
          scoreReasons: c.reasons as unknown as Prisma.InputJsonValue,
          segments: { create: segs.map((s, i) => ({ idx: i, startSec: s.start, endSec: s.end, text: s.text, wordsJson: s.words as unknown as Prisma.InputJsonValue })) },
        },
      });
    }
  });

  // thumbnails from the real frames
  const clips = await db.clip.findMany({ where: { sourceVideoId: src.id, thumbnailKey: null } });
  for (const clip of clips) {
    const t = Math.min(clip.startSec + 1, (clip.startSec + clip.endSec) / 2);
    const tk = newKey("thumbs", src.project.userId, "jpg");
    await ensureDirFor(tk);
    await run(ffmpeg(), ["-hide_banner", "-nostdin", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", keyPath(tk)], { timeoutMs: 60_000, signal: ctx.signal });
    await db.clip.update({ where: { id: clip.id }, data: { thumbnailKey: tk } });
  }

  return {
    durationSec: info.durationSec,
    words: words.length,
    language: transcript?.language ?? null,
    clips: candidates.length,
    note: words.length === 0 ? "No speech detected, so no speech-based clips were proposed." : undefined,
  };
}

// ---------------- RENDER ----------------

export type RenderParams = {
  resolution: Resolution;
  aspect: Aspect;
  framing: Framing;
  cropX: number;
  preset: PresetId;
  removeSilence: boolean;
  burnSubtitles: boolean;
  style?: Partial<SubtitleStyle>;
  trimStart?: number; // clip-relative seconds
  trimEnd?: number;
  cards?: WordCard[];
  bgColor?: string; // fill colour for empty areas in Fit+blur / Bars framing
  watermark?: { input: number; x: number; y: number; scale: number; opacity: number }; // overlay drawn over the render
};

export async function render(ctx: Ctx) {
  const job = ctx.job;
  const params = job.params as unknown as RenderParams;
  await setStatus(ctx, "validating", 1);
  const clip = await db.clip.findUnique({
    where: { id: job.clipId! },
    include: { sourceVideo: true, project: true, segments: { orderBy: { idx: "asc" } } },
  });
  if (!clip || clip.project.userId !== job.userId) throw new JobFailure("Clip not found");
  const src = clip.sourceVideo;
  if (!src.storageKey || src.durationSec == null) throw new JobFailure("Source media is missing");
  const preset = PRESETS[params.preset];
  if (!preset) throw new JobFailure("Unknown preset");

  await setStatus(ctx, "editing", 5);
  // The clip's saved timeline. Clips never opened in the new editor (and jobs queued before it existed)
  // get the timeline the editor would create from these render settings, so they render as before.
  const stored = await db.timeline.findUnique({ where: { clipId: clip.id }, include: { tracks: { include: { items: true } }, markers: true } });
  const analysis = (src.analysis ?? { silences: [] }) as { silences: Interval[] };
  const doc: TimelineDoc = stored
    ? rowsToDoc(stored)
    : defaultTimeline({
        clip: { startSec: clip.startSec, endSec: clip.endSec, sourceVideoId: src.id },
        sourceDurationSec: src.durationSec, aspect: params.aspect, trimStart: params.trimStart, trimEnd: params.trimEnd,
        removeSilence: params.removeSilence, silences: analysis.silences, fps: pickFps(src.fps),
      });
  const valid = timelineSchema.safeParse(doc);
  if (!valid.success) throw new JobFailure(`The timeline is not valid: ${valid.error.issues[0]?.message ?? "unknown problem"}`);
  let media: Map<string, PlanMedia>;
  try {
    const { assets, sources } = await checkRefs(job.userId, doc);
    media = new Map<string, PlanMedia>([
      ...assets.map((m) => [`asset:${m.id}`, { path: keyPath(m.storageKey), kind: m.kind, durationSec: m.durationSec, width: m.width ?? 0, height: m.height ?? 0, hasAudio: m.hasAudio }] as const),
      ...sources.map((m) => [`source:${m.id}`, { path: keyPath(m.storageKey!), kind: "VIDEO" as const, durationSec: m.durationSec, width: m.width ?? 0, height: m.height ?? 0, hasAudio: Boolean(m.hasAudio) }] as const),
    ]);
  } catch {
    throw new JobFailure("A file used on the timeline is missing");
  }
  const plan = (() => {
    try {
      return planTimeline(doc, media);
    } catch (e) {
      throw new JobFailure(e instanceof Error ? e.message : "The timeline cannot be rendered");
    }
  })();
  const outDur = plan.durationSec;
  const track = (type: string) => doc.tracks.find((t) => t.type === type);

  const work = path.join(os.tmpdir(), `ck-render-${job.id}`);
  await mkdir(work, { recursive: true });
  try {
    let assPath: string | undefined;
    // ASS coordinates use a fixed 1920px height; libass scales them to the real output size.
    const size = outputSize(params.aspect, params.resolution);
    const play = { w: Math.round((size.w / size.h) * 1920), h: 1920 };
    // subtitles and cards follow the speech through the main-track items (see timeline/mapping.ts)
    const clipSegs: Segment[] = clip.segments.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text, words: (s.wordsJson as unknown as Word[]) ?? [] }));
    const mapped = mapSegments(doc, src.id, clip.startSec, clipSegs);
    const burnSubs = params.burnSubtitles && !track("SUBTITLE")?.hidden && mapped.length > 0;
    const cards = track("CARDS")?.hidden ? [] : mapCards(doc, src.id, clip.startSec, params.cards ?? []);
    const texts = textEvents(plan.texts, play);
    if (burnSubs || cards.length || texts.length) {
      const vertical = params.aspect === "9:16";
      const base: SubtitleStyle = { ...DEFAULT_STYLE, ...(preset.subtitle === "impact" ? IMPACT_STYLE : preset.subtitle === "punch" ? PUNCH_STYLE : preset.subtitle === "hormozi" ? HORMOZI_STYLE : {}), preset: preset.subtitle, ...params.style };
      const style = vertical ? base : { ...base, fontSize: Math.round(base.fontSize * 0.8), marginV: 230, maxCharsPerLine: 32 };
      assPath = path.join(work, "subs.ass");
      const extra = { styles: [CARD_STYLE_LINE, TITLE_STYLE_LINE], events: [...texts, ...cardEvents(cards, play)] };
      await writeFile(assPath, toAss(burnSubs ? mapped : [], style, play, extra), "utf8");
    }

    // follow-face reframing: one camera path per main-track piece cut from the clip's source
    let reframe: Record<string, unknown> | undefined;
    if (params.framing === "follow") {
      try {
        let full: CachedTrack;
        if (trackCovers(clip.faceTrack, clip.startSec, clip.endSec)) full = clip.faceTrack as unknown as CachedTrack;
        else {
          // detect over the whole clip so the editor preview and later trims can reuse it
          full = await detectFaceTrack(keyPath(src.storageKey), clip.startSec, clip.endSec, { signal: ctx.signal, onProgress: (p) => void setProgress(job.id, 5 + p * 0.04) });
          await db.clip.update({ where: { id: clip.id }, data: { faceTrack: full as unknown as Prisma.InputJsonValue } });
        }
        let keyframes = 0;
        plan.segMeta.forEach((m, k) => {
          const it = m.item;
          if (!it || it.sourceVideoId !== src.id) return;
          const a = it.sourceInFrame / doc.fps;
          const b = a + (it.durationFrames / doc.fps) * it.speed;
          const local = shiftTrack(full, Math.max(full.start, a), Math.min(full.end, b));
          const kf: Keyframe[] = local.keyframes.map((x) => ({ t: x.t / it.speed, x: x.x }));
          keyframes += kf.length;
          plan.segments[k].focusExpr = faceFocusExpr(kf);
        });
        reframe = { mode: "follow", detector: full.detector, sampled: full.sampled, withFace: full.withFace, keyframes, ...(full.withFace ? {} : { note: "No face found; the crop stays centred." }) };
      } catch (e) {
        if (e instanceof JobCancelled || ctx.signal.aborted) throw e;
        console.error("[worker] face detection failed", e instanceof ProcessError ? e.stderrTail.slice(-400) : e);
        reframe = { mode: "follow", note: "Face detection was unavailable (is opencv-python-headless installed?); the crop stays centred." };
      }
    }

    // punch-in shots switch on sentence starts (on the timeline); fixed rhythm without subtitles
    let punchIntervals: Interval[] | undefined;
    if (preset.punchScale) {
      const starts = mapped.map((s) => s.start).filter((t) => t >= 0 && t < outDur);
      const rhythm = starts.length >= 2 ? starts : Array.from({ length: Math.floor(outDur / 2.4) }, (_, i) => (i + 1) * 2.4);
      punchIntervals = punchPlan(rhythm, outDur);
    }

    const outKey = newKey("renders", job.userId, "mp4");
    await ensureDirFor(outKey);
    const outFile = keyPath(outKey);
    const args = buildRenderArgs({
      inputs: plan.inputs,
      segments: plan.segments,
      overlays: plan.overlays,
      audios: plan.audios,
      effects: plan.effects,
      watermarks: params.watermark ? [params.watermark] : undefined,
      fps: doc.fps,
      aspect: params.aspect,
      resolution: params.resolution,
      framing: params.framing,
      cropX: params.cropX,
      bgColor: params.bgColor,
      punchIntervals,
      preset,
      assPath,
      // bundled Inter Black and Instrument Serif (SIL OFL), so text looks the same on every OS
      fontsDir: path.resolve(__dirname, "fonts"),
      output: outFile,
    });
    const winLen = (clip.endSec - clip.startSec);

    await setStatus(ctx, "rendering", 10);
    try {
      await run(ffmpeg(), args, {
        timeoutMs: env().JOB_TIMEOUT_MIN * 60_000,
        signal: ctx.signal,
        onStderr: (l) => {
          const m = l.match(/^out_time_us=(\d+)/);
          if (m) void setProgress(job.id, 10 + (Number(m[1]) / 1e6 / outDur) * 85);
        },
      });
    } catch (e) {
      await rm(outFile, { force: true });
      if (e instanceof ProcessError) {
        console.error("[worker] ffmpeg failed", e.stderrTail.slice(-1200));
        throw new JobFailure("Rendering failed in FFmpeg");
      }
      throw e;
    }

    const out = await probe(ffprobe(), outFile);
    const expect = { ...outputSize(params.aspect, params.resolution), durationSec: outDur };
    const check = verifyOutput(out, expect);
    if (!check.ok) {
      await rm(outFile, { force: true });
      throw new JobFailure(`Output failed verification: ${check.problems.join("; ")}`);
    }

    // Quality audit on the finished file. A full decode error is fatal: a damaged file is never delivered.
    let quality: QualityReport | null = null;
    if (FEATURES.qualityAudit) {
      await setProgress(job.id, 96);
      try {
        quality = await auditOutput({
          ffmpeg: ffmpeg(),
          file: outFile,
          probe: out,
          expected: expect,
          timeoutMs: env().JOB_TIMEOUT_MIN * 60_000,
          signal: ctx.signal,
        });
      } catch (e) {
        if (e instanceof JobCancelled || ctx.signal.aborted) throw e;
        console.error("[worker] quality audit failed", e instanceof Error ? e.message : e);
      }
      if (quality && quality.metrics.decodeErrors.length > 0) {
        await rm(outFile, { force: true });
        throw new JobFailure("Output failed the full decode check");
      }

      // Auto-fix: attempt to repair common QC problems by re-encoding.
      if (FEATURES.qualityAudit && quality) {
        const needsFix =
          quality.checks.some((c) => c.id === "technical" && c.score < 25) ||
          quality.checks.some((c) => c.id === "loudness" && c.score < 17) ||
          quality.checks.some((c) => c.id === "alignment" && c.score < 15);
        if (needsFix) {
          await setProgress(job.id, 97);
          let fixed: AutoFixResult | null = null;
          try {
            fixed = await autoFixOutput({
              ffmpeg: ffmpeg(),
              file: outFile,
              probe: out,
              expected: expect,
              report: quality,
              timeoutMs: env().JOB_TIMEOUT_MIN * 60_000,
              signal: ctx.signal,
            });
          } catch (e) {
            console.error("[worker] auto-fix failed", e instanceof Error ? e.message : e);
          }
          if (fixed && fixed.applied.length > 0 && fixed.file !== outFile) {
            // Re-probe and re-verify the fixed file before replacing the output.
            try {
              const outFixed = await probe(ffprobe(), fixed.file);
              const checkFixed = verifyOutput(outFixed, expect);
              if (checkFixed.ok) {
                await rm(outFile, { force: true });
                await rename(fixed.file, outFile);
                // Re-audit the fixed file so the stored report reflects the fix.
                try {
                  quality = await auditOutput({
                    ffmpeg: ffmpeg(),
                    file: outFile,
                    probe: outFixed,
                    expected: expect,
                    timeoutMs: env().JOB_TIMEOUT_MIN * 60_000,
                    signal: ctx.signal,
                  });
                } catch (e) {
                  console.error("[worker] re-audit after auto-fix failed", e instanceof Error ? e.message : e);
                }
              } else {
                await rm(fixed.file, { force: true });
              }
            } catch (e) {
              console.error("[worker] re-probe after auto-fix failed", e instanceof Error ? e.message : e);
            }
          }
          // Clean up any leftover autofix temp files.
          const workDir = path.dirname(outFile);
          const fixedBase = fixed?.file ? path.basename(fixed.file) : "";
          try {
            const entries = await readdir(workDir);
            for (const entry of entries) {
              if (entry.startsWith(path.basename(outFile, ".mp4") + "-autofix-") && entry !== fixedBase) {
                await rm(path.join(workDir, entry), { force: true });
              }
            }
          } catch {
            // best-effort cleanup
          }
        }
      }
    }

    const st = await stat(outFile);
    const removedSec = !stored && params.removeSilence ? Number((Math.min(winLen, (params.trimEnd ?? winLen) - (params.trimStart ?? 0)) - outDur).toFixed(2)) : undefined;
    return { outputKey: outKey, meta: { ...out, sizeBytes: st.size, ...(removedSec ? { removedSec } : {}), timeline: { stored: Boolean(stored), tracks: doc.tracks.length, items: doc.items.length }, verified: true, ...(quality ? { quality } : {}), ...(reframe ? { reframe } : {}) } };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ---------------- runner ----------------

export async function runJob(job: RenderJob, signal: AbortSignal) {
  const ctx = { job, signal };
  try {
    if (job.kind === "ANALYZE") {
      const result = await analyze(ctx);
      await db.renderJob.updateMany({
        where: { id: job.id, status: { notIn: ["cancelled"] } },
        data: { status: "completed", progress: 100, finishedAt: new Date(), outputMeta: result as unknown as Prisma.InputJsonValue },
      });
    } else {
      const result = await render(ctx);
      await db.$transaction(async (tx) => {
        const r = await tx.renderJob.updateMany({
          where: { id: job.id, status: { notIn: ["cancelled"] } },
          data: { status: "completed", progress: 100, finishedAt: new Date(), outputKey: result.outputKey, outputMeta: result.meta as unknown as Prisma.InputJsonValue },
        });
        if (r.count) await capture(tx, job.userId, job.id);
      });
    }
  } catch (e) {
    const cancelled = e instanceof JobCancelled || signal.aborted;
    const message = e instanceof JobFailure ? e.message : cancelled ? "Cancelled" : "Unexpected processing error";
    if (!(e instanceof JobFailure) && !cancelled) console.error("[worker] job error", job.id, e);
    if (!cancelled) {
      await db.renderJob.updateMany({ where: { id: job.id, status: { notIn: ["cancelled", "completed"] } }, data: { status: "failed", error: message, finishedAt: new Date() } });
    }
    if (job.kind === "RENDER") await refund(job.userId, job.id, cancelled ? "job cancelled" : message);
  }
}
