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
import { parseScenes, parseSilences, proposeClips, type Interval } from "../src/lib/media/clipping";
import { buildSegments, DEFAULT_STYLE, sliceWords, toAss, type Segment, type SubtitleStyle, type Word } from "../src/lib/media/subtitles";
import { buildRenderArgs, keepIntervals, mapTime, outputSize, PRESETS, remapWords, verifyOutput, type Aspect, type Framing, type PresetId, type Resolution } from "../src/lib/media/render";
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

  // effective window, clamped to the real source duration
  const clipLen = clip.endSec - clip.startSec;
  const tStart = Math.max(0, Math.min(params.trimStart ?? 0, clipLen - 0.5));
  const tEnd = Math.max(tStart + 0.5, Math.min(params.trimEnd ?? clipLen, clipLen));
  const absStart = clip.startSec + tStart;
  const absEnd = Math.min(src.durationSec, clip.startSec + tEnd);
  const winLen = absEnd - absStart;

  await setStatus(ctx, "editing", 5);
  const analysis = (src.analysis ?? { silences: [] }) as { silences: Interval[] };
  const localSilences = analysis.silences
    .map((s) => ({ start: s.start - absStart, end: s.end - absStart }))
    .filter((s) => s.end > 0 && s.start < winLen)
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(winLen, s.end) }));
  const keep = params.removeSilence ? keepIntervals(winLen, localSilences) : [{ start: 0, end: winLen }];
  if (!keep.length) throw new JobFailure("Nothing left after removing silence");
  const outDur = keep.reduce((a, k) => a + (k.end - k.start), 0);

  const work = path.join(os.tmpdir(), `ck-render-${job.id}`);
  await mkdir(work, { recursive: true });
  try {
    let assPath: string | undefined;
    if (params.burnSubtitles && clip.segments.length) {
      const segs: Segment[] = clip.segments.map((s) => ({
        start: s.startSec - tStart,
        end: s.endSec - tStart,
        text: s.text,
        words: ((s.wordsJson as unknown as Word[]) ?? []).map((w) => ({ ...w, s: w.s - tStart, e: w.e - tStart })),
      }));
      const remapped = segs
        .map((s) => {
          const words = remapWords(s.words.filter((w) => w.e > 0 && w.s < winLen), keep);
          if (!words.length) return null;
          return { start: words[0].s, end: words[words.length - 1].e, text: words.map((w) => w.w).join(" "), words };
        })
        .filter((s): s is Segment => s !== null);
      // ASS coordinates use a fixed 1920px height; libass scales them to the real output size.
      const size = outputSize(params.aspect, params.resolution);
      const play = { w: Math.round((size.w / size.h) * 1920), h: 1920 };
      const vertical = params.aspect === "9:16";
      const base: SubtitleStyle = { ...DEFAULT_STYLE, preset: preset.subtitle, ...params.style };
      const style = vertical ? base : { ...base, fontSize: Math.round(base.fontSize * 0.8), marginV: 230, maxCharsPerLine: 32 };
      assPath = path.join(work, "subs.ass");
      await writeFile(assPath, toAss(remapped, style, play), "utf8");
    }

    // follow-face reframing: reuse the cached track for this exact window or detect now
    let followExpr: string | undefined;
    let reframe: Record<string, unknown> | undefined;
    if (params.framing === "follow") {
      try {
        let track: CachedTrack;
        if (trackCovers(clip.faceTrack, absStart, absEnd)) track = shiftTrack(clip.faceTrack as unknown as CachedTrack, absStart, absEnd);
        else {
          // detect over the whole clip so the editor preview and later trims can reuse it
          const full = await detectFaceTrack(keyPath(src.storageKey), clip.startSec, clip.endSec, { signal: ctx.signal, onProgress: (p) => void setProgress(job.id, 5 + p * 0.04) });
          await db.clip.update({ where: { id: clip.id }, data: { faceTrack: full as unknown as Prisma.InputJsonValue } });
          track = shiftTrack(full, absStart, absEnd);
        }
        // move keyframes onto the edited timeline (after silence removal)
        const mapped: Keyframe[] = [];
        for (const k of track.keyframes) {
          const t = mapTime(k.t, keep) ?? 0;
          if (!mapped.length || t > mapped[mapped.length - 1].t + 0.01) mapped.push({ t, x: k.x });
        }
        followExpr = faceFocusExpr(mapped);
        reframe = { mode: "follow", detector: track.detector, sampled: track.sampled, withFace: track.withFace, keyframes: mapped.length, ...(track.withFace ? {} : { note: "No face found; the crop stays centred." }) };
      } catch (e) {
        if (e instanceof JobCancelled || ctx.signal.aborted) throw e;
        console.error("[worker] face detection failed", e instanceof ProcessError ? e.stderrTail.slice(-400) : e);
        reframe = { mode: "follow", note: "Face detection was unavailable (is opencv-python-headless installed?); the crop stays centred." };
      }
    }

    const outKey = newKey("renders", job.userId, "mp4");
    await ensureDirFor(outKey);
    const outFile = keyPath(outKey);
    const args = buildRenderArgs({
      input: keyPath(src.storageKey),
      clipStart: absStart,
      clipEnd: absEnd,
      srcFps: src.fps ?? 30,
      hasAudio: Boolean(src.hasAudio),
      aspect: params.aspect,
      resolution: params.resolution,
      framing: params.framing,
      cropX: params.cropX,
      focusExpr: followExpr,
      preset,
      keep,
      assPath,
      // bundled Inter Black (SIL OFL), so subtitles look the same on every OS without installing fonts
      fontsDir: path.resolve(__dirname, "fonts"),
      output: outFile,
    });

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
    const st = await stat(outFile);
    return { outputKey: outKey, meta: { ...out, sizeBytes: st.size, removedSec: Number((winLen - outDur).toFixed(2)), verified: true, ...(reframe ? { reframe } : {}) } };
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
