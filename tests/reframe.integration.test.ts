/**
 * Real follow-face render: a 16:9 video with a face moving left to right is rendered to 9:16 with
 * framing "follow". The output is checked with the same face detector: the face must stay near the
 * centre at the start and at the end, where a centred crop would lose it.
 * Needs FACE_VIDEO (16:9 with a moving face, e.g. the NASA astronaut photo panned across), Whisper and OpenCV.
 */
import { execFileSync } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ensureDirFor, keyPath, newKey } from "@/lib/storage";
import { runJob } from "../worker/pipeline";

const VIDEO = process.env.FACE_VIDEO;
const enabled = Boolean(VIDEO && existsSync(VIDEO));

function faceX(file: string, t: number): number | null {
  const out = execFileSync(process.env.WHISPER_PYTHON ?? "python3", ["-I", path.resolve("worker/vision/faces.py"), file, String(t), String(t + 0.3), "4"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out).samples[0];
  if (!s?.faces.length) return null;
  return s.faces.reduce((a: number[], b: number[]) => (b[2] * b[3] > a[2] * a[3] ? b : a))[0];
}

describe.skipIf(!enabled)("follow-face reframing (real render)", () => {
  let userId = "";
  let projectId = "";
  let clipId = "";
  beforeAll(async () => {
    userId = (await db.user.create({ data: { email: `reframe-${Date.now()}@test.local`, passwordHash: "x", tokenBalance: 1000 } })).id;
    projectId = (await db.project.create({ data: { userId, title: "reframe" } })).id;
    const key = newKey("sources", userId, "mp4");
    await ensureDirFor(key);
    await copyFile(VIDEO!, keyPath(key));
    const src = await db.sourceVideo.create({ data: { projectId, kind: "UPLOAD", platform: "upload", accessState: "PROCESSABLE", storageKey: key } });
    const job = await db.renderJob.create({ data: { userId, projectId, sourceVideoId: src.id, kind: "ANALYZE", status: "validating" } });
    await runJob(job, new AbortController().signal);
    const clip = await db.clip.findFirst({ where: { sourceVideoId: src.id } });
    clipId = clip?.id ?? (await db.clip.create({ data: { projectId, sourceVideoId: src.id, startSec: 0, endSec: 10.5, title: "manual" } })).id;
    await db.clip.update({ where: { id: clipId }, data: { startSec: 0, endSec: 10.5 } });
  }, 600_000);
  afterAll(async () => {
    if (process.env.KEEP_TEST_MEDIA !== "1") await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it("keeps the moving face centred in a 9:16 render", async () => {
    const job = await db.renderJob.create({
      data: { userId, projectId, clipId, kind: "RENDER", status: "validating", params: { resolution: "720p", aspect: "9:16", framing: "follow", cropX: 0.5, preset: "clean_professional", removeSilence: false, burnSubtitles: false } },
    });
    await runJob(job, new AbortController().signal);
    const done = await db.renderJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.error).toBeNull();
    expect(done.status).toBe("completed");
    const meta = done.outputMeta as { reframe?: { withFace: number; sampled: number }; video?: { width: number; height: number } };
    expect(meta.video).toMatchObject({ width: 720, height: 1280 });
    expect(meta.reframe?.withFace).toBeGreaterThan(meta.reframe!.sampled * 0.8);
    const out = keyPath(done.outputKey!);
    const early = faceX(out, 0.8);
    const late = faceX(out, 9.5);
    console.log("[reframe] face x in output:", { early, late, meta: meta.reframe });
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(Math.abs(early! - 0.5)).toBeLessThan(0.12);
    expect(Math.abs(late! - 0.5)).toBeLessThan(0.12);
    const cached = await db.clip.findUniqueOrThrow({ where: { id: clipId } });
    expect(cached.faceTrack).toBeTruthy();
    if (process.env.KEEP_TEST_MEDIA !== "1") await rm(out, { force: true });
  }, 600_000);
});
