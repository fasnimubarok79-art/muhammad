/**
 * Real end-to-end pipeline test: ffprobe, silencedetect, scdet, Whisper STT, clip proposal,
 * ASS subtitles and an H.264/AAC 1080x1920 render verified with ffprobe.
 * Requires TEST_VIDEO (a video file with speech) plus a working WHISPER_MODEL; skipped otherwise.
 */
import { copyFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ensureDirFor, keyPath, newKey } from "@/lib/storage";
import { probe } from "@/lib/media/probe";
import { newCard } from "@/lib/media/cards";
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
});
