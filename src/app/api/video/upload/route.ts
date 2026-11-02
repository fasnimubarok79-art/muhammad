import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { db } from "@/lib/db";
import { ownedProject } from "@/lib/access";
import { env } from "@/lib/env";
import { ApiError, authedRoute, json } from "@/lib/http";
import { enqueueAnalyze, publicJob } from "@/lib/jobs";
import { probe } from "@/lib/media/probe";
import { RATE } from "@/lib/rate-limit";
import { ensureDirFor, keyPath, newKey } from "@/lib/storage";
import { idSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

/**
 * Streaming upload: PUT /api/video/upload?projectId=...  body = raw file bytes,
 * headers: Content-Type (video/*), X-File-Name. The file is streamed to protected storage with
 * a hard size limit, then verified with ffprobe before a processing job is queued.
 */
export const PUT = authedRoute(
  async ({ req, user }) => {
    const projectId = idSchema.parse(req.nextUrl.searchParams.get("projectId"));
    const project = await ownedProject(user.id, projectId);
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = TYPES[type];
    if (!ext) throw new ApiError(415, "UNSUPPORTED_TYPE", "Upload an MP4, MOV, WebM or MKV video");
    const max = env().MAX_UPLOAD_MB * 1024 * 1024;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > max) throw new ApiError(413, "TOO_LARGE", `Maximum file size is ${env().MAX_UPLOAD_MB} MB`);
    if (!req.body) throw new ApiError(400, "EMPTY", "Empty upload");
    const name = decodeURIComponent(req.headers.get("x-file-name") ?? "video").replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120);

    const key = newKey("sources", user.id, ext);
    await ensureDirFor(key);
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _e, cb) {
        size += chunk.length;
        if (size > max) return cb(new ApiError(413, "TOO_LARGE", `Maximum file size is ${env().MAX_UPLOAD_MB} MB`));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(req.body as unknown as WebReadableStream), limit, createWriteStream(keyPath(key), { flags: "wx" }));
      if (size === 0) throw new ApiError(400, "EMPTY", "Empty upload");
      const info = await probe(env().FFPROBE_PATH, keyPath(key)).catch(() => null);
      if (!info?.video || !(info.durationSec > 0)) throw new ApiError(422, "NOT_A_VIDEO", "The file is not a readable video");
      if (info.durationSec > env().MAX_SOURCE_MINUTES * 60) throw new ApiError(422, "TOO_LONG", `Maximum duration is ${env().MAX_SOURCE_MINUTES} minutes`);
    } catch (e) {
      await rm(keyPath(key), { force: true });
      throw e;
    }
    const { source, job } = await db.$transaction(async (tx) => {
      const source = await tx.sourceVideo.create({
        data: { projectId: project.id, kind: "UPLOAD", platform: "upload", accessState: "PROCESSABLE", originalName: name, storageKey: key, mimeType: type, sizeBytes: BigInt(size) },
      });
      const job = await enqueueAnalyze(user.id, project.id, source.id, tx);
      return { source, job };
    });
    return json({ source: { id: source.id, originalName: source.originalName, sizeBytes: size }, job: publicJob(job) }, 201);
  },
  { rate: RATE.upload, rateKey: "upload" },
);
