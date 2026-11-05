/**
 * Real end-to-end pipeline test: ffprobe, silencedetect, scdet, Whisper STT, clip proposal,
 * ASS subtitles and an H.264/AAC 1080x1920 render verified with ffprobe.
 * Requires TEST_VIDEO (a video file with speech) plus a working WHISPER_MODEL; skipped otherwise.
 */
import { copyFile, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ensureDirFor, keyPath, newKey } from "@/lib/storage";
import { probe } from "@/lib/media/probe";
import { newCard } from "@/lib/media/cards";
import { keywordIndex, PUNCH_STYLE } from "@/lib/media/subtitles";
import { blankItem } from "@/lib/timeline/defaults";
import { mapSegments } from "@/lib/timeline/mapping";
import { addItem, mainTrack, move, setTrack, split } from "@/lib/timeline/ops";
import { loadOrCreateTimeline, rowsToDoc, saveTimeline } from "@/lib/timeline/store";
import type { TimelineDoc } from "@/lib/timeline/schema";
import { runJob } from "../worker/pipeline";

const VIDEO = process.env.TEST_VIDEO;
const enabled = Boolean(VIDEO && existsSync(VIDEO));

describe.skipIf(!enabled)("real video pipeline", () => {
  let userId = "";
  let projectId = "";
  let sourceId = "";
  const email = `pipeline-${Date.now()}@test.local`;

  beforeAll(async () => {
    const u = await db.user.create({ data: { email, passwordHash: "x", tokenBalance: 1000 } });
    userId = u.id;
    const p = await db.project.create({ data: { userId, title: "pipeline test" } });
    projectId = p.id;
    const key = newKey("sources", userId, "mp4");
    await ensureDirFor(key);
    await copyFile(VIDEO!, keyPath(key));
    const s = await db.sourceVideo.create({ data: { projectId, kind: "UPLOAD", platform: "upload", accessState: "PROCESSABLE", storageKey: key, originalName: "test.mp4" } });
    sourceId = s.id;
  });

  afterAll(async () => {
    const src = await db.sourceVideo.findMany({ where: { projectId }, select: { storageKey: true } });
    const jobs = await db.renderJob.findMany({ where: { projectId }, select: { outputKey: true } });
    const clips = await db.clip.findMany({ where: { projectId }, select: { thumbnailKey: true } });
    for (const k of [...src.map((s) => s.storageKey), ...jobs.map((j) => j.outputKey), ...clips.map((c) => c.thumbnailKey)]) {
      if (k && process.env.KEEP_TEST_MEDIA !== "1") await rm(keyPath(k), { force: true });
    }
    if (process.env.KEEP_TEST_MEDIA !== "1") await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });

  it("analyzes: real transcript, silences, clip candidates inside the source duration", async () => {
    const job = await db.renderJob.create({ data: { userId, projectId, sourceVideoId: sourceId, kind: "ANALYZE", status: "validating" } });
    await runJob(job, new AbortController().signal);
    const done = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.error).toBeNull();
    expect(done.status).toBe("completed");

    const src = await db.sourceVideo.findUniqueOrThrow({ where: { id: sourceId }, include: { transcript: true } });
    expect(src.durationSec).toBeGreaterThan(1);
    expect(src.transcript?.text.length).toBeGreaterThan(10);
    const words = src.transcript!.wordsJson as Array<{ s: number; e: number }>;
    expect(words.length).toBeGreaterThan(5);
    for (const w of words) expect(w.e).toBeLessThanOrEqual(src.durationSec! + 0.05);

    const clips = await db.clip.findMany({ where: { sourceVideoId: sourceId }, include: { segments: true } });
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) {
      expect(c.startSec).toBeGreaterThanOrEqual(0);
      expect(c.endSec).toBeLessThanOrEqual(src.durationSec! + 0.01);
      expect(c.segments.length).toBeGreaterThan(0);
      expect(c.thumbnailKey).toBeTruthy();
      expect(existsSync(keyPath(c.thumbnailKey!))).toBe(true);
    }
    console.log("[pipeline] transcript:", src.transcript?.text);
    console.log("[pipeline] clips:", clips.map((c) => `${c.startSec.toFixed(2)}-${c.endSec.toFixed(2)} score=${c.score} "${c.title}"`));
  }, 600_000);

  it("renders 1080x1920 H.264/AAC with burned karaoke subtitles and silence removal, verified by ffprobe", async () => {
    const clip = await db.clip.findFirstOrThrow({ where: { sourceVideoId: sourceId }, orderBy: { score: "desc" } });
    const job = await db.renderJob.create({
      data: {
        userId, projectId, clipId: clip.id, kind: "RENDER", status: "validating",
        params: { resolution: "1080p", aspect: "9:16", framing: "blur", cropX: 0.5, preset: "viral_short", removeSilence: true, burnSubtitles: true },
      },
    });
    await runJob(job, new AbortController().signal);
    const done = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.error).toBeNull();
    expect(done.status).toBe("completed");
    const info = await probe("ffprobe", keyPath(done.outputKey!));
    expect(info.formatName).toContain("mp4");
    expect(info.video?.codec).toBe("h264");
    expect(info.video?.width).toBe(1080);
    expect(info.video?.height).toBe(1920);
    expect(info.audio?.codec).toBe("aac");
    console.log("[pipeline] render:", JSON.stringify({ key: done.outputKey, dur: info.durationSec, fps: info.video?.fps, meta: done.outputMeta }));
  }, 600_000);
  it("renders the cinematic_punch preset (punch captions, punch-in zoom, flash, word card) end to end", async () => {
    const clip = await db.clip.findFirstOrThrow({ where: { sourceVideoId: sourceId }, orderBy: { score: "desc" } });
    const job = await db.renderJob.create({
      data: {
        userId, projectId, clipId: clip.id, kind: "RENDER", status: "validating",
        params: { resolution: "1080p", aspect: "9:16", framing: "blur", cropX: 0.5, preset: "cinematic_punch", removeSilence: false, burnSubtitles: true, cards: [{ ...newCard(1, "lebih", "paper"), dur: 1.2 }] },
      },
    });
    await runJob(job, new AbortController().signal);
    const done = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.error).toBeNull();
    expect(done.status).toBe("completed");
    const info = await probe("ffprobe", keyPath(done.outputKey!));
    expect(info.video?.width).toBe(1080);
    expect(info.video?.height).toBe(1920);
    expect(info.audio?.codec).toBe("aac");
    // the paper card (1.0s to 2.2s) is really in the pixels: a bright frame, unlike the speaker footage
    const yavg = (t: number) => {
      const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(t), "-i", keyPath(done.outputKey!), "-frames:v", "1", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { encoding: "utf8" });
      return Number(/YAVG=([\d.]+)/.exec(r.stderr)?.[1] ?? NaN);
    };
    const onCard = yavg(1.6);
    const offCard = yavg(3.5);
    console.log("[pipeline] card luma", { onCard, offCard });
    expect(onCard).toBeGreaterThan(200);
    expect(onCard - offCard).toBeGreaterThan(60);
  }, 600_000);
  // ---------- multi-track timeline ----------
  const frameStats = (file: string, t: number, crop?: string) => {
    const vf = `${crop ? `crop=${crop},` : ""}signalstats,metadata=print`;
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", vf, "-f", "null", "-"], { encoding: "utf8" });
    const get = (k: string) => Number(new RegExp(`${k}=([\\d.]+)`).exec(r.stderr)?.[1] ?? NaN);
    return { y: get("YAVG"), sat: get("SATAVG") };
  };
  /** x centre (0..1) of strongly red pixels in a frame, from a 1-row-per-column scan of a 108x192 thumbnail. */
  const redCentre = (file: string, t: number) => {
    const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=108:192", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    let sum = 0; let n = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] > 180 && raw[i + 1] < 80 && raw[i + 2] < 80) { sum += ((i / 3) % 108) / 107; n++; }
    return n > 20 ? sum / n : NaN;
  };
  /** Share of pure-green pixels (the B-roll test colour) in a frame. */
  const greenShare = (file: string, t: number) => {
    const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=108:192", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    let n = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] < 90 && raw[i + 1] > 170 && raw[i + 2] < 90) n++;
    return n / (raw.length / 3);
  };
  const band = (file: string, from: number, to: number, filter: string) => {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(from), "-t", String(to - from), "-i", file, "-vn", "-af", `${filter},astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level`, "-f", "null", "-"], { encoding: "utf8" });
    const all = [...r.stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -120 : Number(m[1])));
    return all.length ? all[all.length - 1] : -120;
  };
  const makeAsset = async (kind: "IMAGE" | "AUDIO" | "VIDEO", lavfi: string[], ext: string, extra: { durationSec?: number; width?: number; height?: number; hasAudio?: boolean }) => {
    const key = newKey("assets", userId, ext);
    await ensureDirFor(key);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...lavfi, keyPath(key)]);
    return db.mediaAsset.create({ data: { userId, projectId, kind, name: `test-${kind.toLowerCase()}.${ext}`, storageKey: key, mimeType: kind === "IMAGE" ? "image/png" : kind === "AUDIO" ? "audio/wav" : "video/mp4", sizeBytes: BigInt(1), hasAudio: false, ...extra } });
  };
  const renderClip = async (clipId: string, extra: Record<string, unknown> = {}) => {
    const job = await db.renderJob.create({ data: { userId, projectId, clipId, kind: "RENDER", status: "validating", params: { resolution: "720p", aspect: "9:16", framing: "crop", cropX: 0.5, preset: "clean_professional", removeSilence: false, burnSubtitles: true, ...extra } } });
    await runJob(job, new AbortController().signal);
    const done = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.error).toBeNull();
    return keyPath(done.outputKey!);
  };

  it("renders a multi-track timeline exactly as laid out: split + moved video, gap, keyframed overlay, B-roll, audio, effect, text", async () => {
    const clip = await db.clip.findFirstOrThrow({ where: { sourceVideoId: sourceId }, orderBy: { score: "desc" } });
    const red = await makeAsset("IMAGE", ["-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1"], "png", { width: 320, height: 180 });
    const tone = await makeAsset("AUDIO", ["-f", "lavfi", "-i", "sine=frequency=1000:duration=4"], "wav", { durationSec: 4, hasAudio: true });
    const broll = await makeAsset("VIDEO", ["-f", "lavfi", "-i", "color=c=0x00FF00:s=640x360:r=30:d=3", "-pix_fmt", "yuv420p"], "mp4", { durationSec: 3, width: 640, height: 360 });
    const { row } = await loadOrCreateTimeline(userId, clip.id);
    let doc: TimelineDoc = rowsToDoc(row);
    const fps = doc.fps;
    const tr = (type: string) => doc.tracks.find((t) => t.type === type)!.id;
    // main: split at 3 s, second part 1 s later (black gap 3-4 s), and cut it to end at 7 s
    doc = split(doc, 3 * fps)!.doc;
    const second = doc.items.filter((i) => i.trackId === mainTrack(doc).id).sort((a, b) => a.startFrame - b.startFrame)[1];
    doc = move(doc, [second.id], fps)!;
    doc = { ...doc, items: doc.items.map((i) => (i.id === second.id ? { ...i, durationFrames: 3 * fps } : i)) };
    // red picture moving left to right between 1 s and 3 s, eased
    const ov = addItem(doc, { ...blankItem(tr("OVERLAY"), "image", 2 * fps, { mediaAssetId: red.id }) }, fps)!;
    doc = { ...ov.doc, items: ov.doc.items.map((i) => (i.id === ov.id ? { ...i, transform: { ...i.transform!, scale: 0.25 }, keyframes: [{ prop: "x", frame: 0, value: 0.25, ease: "linear" }, { prop: "x", frame: 2 * fps, value: 0.75, ease: "linear" }] } : i)) };
    // B-roll filling the frame 5-6 s, 1 kHz tone 0.5-2.5 s, black-and-white 4.2-4.8 s, a title 0-2 s
    const br = addItem(doc, { ...blankItem(tr("BROLL"), "video", fps, { mediaAssetId: broll.id }) }, 5 * fps)!;
    doc = { ...br.doc, items: br.doc.items.map((i) => (i.id === br.id ? { ...i, volume: 0, transform: { ...i.transform!, fit: "cover" } } : i)) };
    doc = addItem(doc, { ...blankItem(tr("AUDIO"), "audio", 2 * fps, { mediaAssetId: tone.id }) }, fps / 2)!.doc;
    doc = addItem(doc, { ...blankItem(tr("EFFECTS"), "effect", Math.round(0.6 * fps)), effects: { fadeIn: 0, fadeOut: 0, type: "bw", intensity: 1 } }, Math.round(4.2 * fps))!.doc;
    doc = addItem(doc, { ...blankItem(tr("TEXT"), "text", 2 * fps), text: { text: "TITLE", font: "sans", size: 120, color: "#FFFFFF", outline: 4, anim: "cut" } }, 0)!.doc;
    const saved = await saveTimeline(userId, clip.id, row.version, doc);
    expect(saved.version).toBe(row.version + 1);
    await expect(saveTimeline(userId, clip.id, row.version, doc)).rejects.toMatchObject({ status: 409 }); // stale version

    const out = await renderClip(clip.id);
    const info = await probe("ffprobe", out);
    expect([info.video?.width, info.video?.height, info.video?.codec, info.audio?.codec]).toEqual([720, 1280, "h264", "aac"]);
    expect(info.durationSec).toBeCloseTo(7, 0); // 3 s + 1 s gap + 3 s
    const x15 = redCentre(out, 1.5);
    const x25 = redCentre(out, 2.5);
    const gap = frameStats(out, 3.5, "iw:ih*0.3:0:ih*0.35");
    const bw = frameStats(out, 4.5);
    const brollOn = greenShare(out, 5.5);
    const brollOff = greenShare(out, 4.9);
    const tone1 = band(out, 0.7, 2.3, "bandpass=f=1000:width_type=h:w=40");
    const tone0 = band(out, 3.0, 4.0, "bandpass=f=1000:width_type=h:w=40");
    console.log("[timeline] measured", { x15, x25, gap, bw, brollOn, brollOff, tone1, tone0 });
    expect(x15).toBeGreaterThan(0.35); expect(x15).toBeLessThan(0.45); // preview maths: x = 0.25 + 0.5 * 0.25 = 0.375
    expect(x25).toBeGreaterThan(0.55); expect(x25).toBeLessThan(0.67); // 0.625
    expect(gap.y).toBeLessThan(25); // black gap
    expect(bw.sat).toBeLessThan(2); // black-and-white effect
    expect(brollOn).toBeGreaterThan(0.8); // green B-roll covers the frame (captions may sit on it)
    expect(brollOff).toBeLessThan(0.02); // and is gone outside its 5-6 s slot
    expect(tone1 - tone0).toBeGreaterThan(20); // the tone plays only where it was placed
  }, 600_000);

  it("keeps burned-in subtitles in sync with the speech after split, move and a hidden picture (real render)", async () => {
    const clip = await db.clip.findFirstOrThrow({ where: { sourceVideoId: sourceId }, orderBy: { score: "desc" } });
    const { row } = await loadOrCreateTimeline(userId, clip.id);
    let doc: TimelineDoc = rowsToDoc(row);
    // fresh layout: only the clip's own video, split at 4 s, the second half 1.5 s later; picture hidden so captions sit on black
    const main = mainTrack(doc);
    const fps = doc.fps;
    const len = Math.min(Math.round((clip.endSec - clip.startSec) * fps), 12 * fps);
    doc = { ...doc, items: doc.items.filter((i) => i.trackId === main.id).slice(0, 1).map((i) => ({ ...i, startFrame: 0, sourceInFrame: Math.round(clip.startSec * fps), durationFrames: len })) };
    doc = split(doc, 4 * doc.fps)!.doc;
    const second = doc.items.sort((a, b) => a.startFrame - b.startFrame)[1];
    doc = move(doc, [second.id], Math.round(1.5 * doc.fps))!;
    doc = setTrack(doc, main.id, { hidden: true });
    await saveTimeline(userId, clip.id, row.version, doc);
    const out = await renderClip(clip.id, { preset: "clean_professional", style: { ...PUNCH_STYLE } });

    const segs = (await db.subtitleSegment.findMany({ where: { clipId: clip.id }, orderBy: { idx: "asc" } })).map((s) => ({ start: s.startSec, end: s.endSec, text: s.text, words: s.wordsJson as Array<{ w: string; s: number; e: number }> }));
    const mapped = mapSegments(doc, sourceId, clip.startSec, segs);
    const expected: number[] = [];
    for (const s of mapped) {
      if (s.start > 0.3) expected.push(s.start);
      const k = keywordIndex(s.words);
      if (s.words[k] && s.words[k].s - s.start > 0.05) expected.push(s.words[k].s);
    }
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", out, "-vf", "crop=iw:ih*0.6:0:ih*0.2,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
    const times: number[] = []; const yv: number[] = []; let t = 0;
    for (const line of r.stderr.split("\n")) {
      const m = /pts_time:([\d.]+)/.exec(line); if (m) t = Number(m[1]);
      const y = /YAVG=([\d.]+)/.exec(line); if (y) { times.push(t); yv.push(Number(y[1])); }
    }
    const changes = times.filter((_, i) => i > 0 && Math.abs(yv[i] - yv[i - 1]) > 0.1);
    const offsets = expected.map((e) => Math.min(...changes.map((c) => Math.abs(c - e))) * 1000);
    const worst = Math.max(...offsets);
    console.log("[timeline] subtitle sync", { events: expected.length, worstMs: Math.round(worst), offsets: offsets.map(Math.round) });
    expect(expected.length).toBeGreaterThan(4);
    expect(worst).toBeLessThanOrEqual(150);
  }, 600_000);
});
