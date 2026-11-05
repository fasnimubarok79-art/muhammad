import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ownedProject } from "@/lib/access";
import { env } from "@/lib/env";
import { ApiError, authedRoute, json } from "@/lib/http";
import { ASSET_TYPES, inspectAsset, makeThumb, publicAsset } from "@/lib/media/assets";
import { displaySize } from "@/lib/media/probe";
import { RATE } from "@/lib/rate-limit";
import { ensureDirFor, keyPath, newKey } from "@/lib/storage";
import { idSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { id: string };

const Query = z.object({
  q: z.string().trim().max(80).optional(),
  kind: z.enum(["VIDEO", "AUDIO", "IMAGE"]).optional(),
  sort: z.enum(["new", "name", "duration"]).default("new"),
});

/** The user's media library (all projects) plus this project's own source videos. */
export const GET = authedRoute<P>(async ({ req, user, params }) => {
  const project = await ownedProject(user.id, idSchema.parse(params.id));
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const orderBy: Prisma.MediaAssetOrderByWithRelationInput = q.sort === "name" ? { name: "asc" } : q.sort === "duration" ? { durationSec: { sort: "desc", nulls: "last" } } : { createdAt: "desc" };
  const assets = await db.mediaAsset.findMany({
    where: { userId: user.id, ...(q.kind ? { kind: q.kind } : {}), ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}) },
    orderBy, take: 300, include: { _count: { select: { items: true } } },
  });
  const sources = q.kind && q.kind !== "VIDEO" ? [] : await db.sourceVideo.findMany({
    where: { projectId: project.id, storageKey: { not: null }, ...(q.q ? { originalName: { contains: q.q, mode: "insensitive" } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, originalName: true, platform: true, durationSec: true, width: true, height: true, fps: true, hasAudio: true, createdAt: true },
  });
  return json({
    assets: assets.map(publicAsset),
    sources: sources.map((s) => ({ ...s, name: s.originalName ?? s.platform, url: `/api/media/source/${s.id}` })),
  });
});

/** Streaming upload into the library: PUT body = raw bytes, headers Content-Type and X-File-Name. */
export const PUT = authedRoute<P>(
  async ({ req, user, params }) => {
    const project = await ownedProject(user.id, idSchema.parse(params.id));
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const t = ASSET_TYPES[type];
    if (!t) throw new ApiError(415, "UNSUPPORTED_TYPE", "Upload a video (MP4, MOV, WebM, MKV), audio (MP3, WAV, M4A, AAC, OGG) or image (PNG, JPG, WebP)");
    const max = env().MAX_UPLOAD_MB * 1024 * 1024;
    if (Number(req.headers.get("content-length") ?? 0) > max) throw new ApiError(413, "TOO_LARGE", `Maximum file size is ${env().MAX_UPLOAD_MB} MB`);
    if (!req.body) throw new ApiError(400, "EMPTY", "Empty upload");
    const name = decodeURIComponent(req.headers.get("x-file-name") ?? "media").replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || "media";

    const key = newKey("assets", user.id, t.ext);
    await ensureDirFor(key);
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _e, cb) {
        size += chunk.length;
        if (size > max) return cb(new ApiError(413, "TOO_LARGE", `Maximum file size is ${env().MAX_UPLOAD_MB} MB`));
        cb(null, chunk);
      },
    });
    let thumbKey: string | null = null;
    try {
      await pipeline(Readable.fromWeb(req.body as unknown as WebReadableStream), limit, createWriteStream(keyPath(key), { flags: "wx" }));
      if (size === 0) throw new ApiError(400, "EMPTY", "Empty upload");
      const info = await inspectAsset(keyPath(key), t.kind);
      if (!info) throw new ApiError(422, "NOT_MEDIA", `The file is not a readable ${t.kind.toLowerCase()}`);
      if (t.kind !== "IMAGE" && info.durationSec > env().MAX_SOURCE_MINUTES * 60) throw new ApiError(422, "TOO_LONG", `Maximum duration is ${env().MAX_SOURCE_MINUTES} minutes`);
      const shown = info.video ? displaySize(info.video) : null; // phones store portrait video as rotated landscape
      if (t.kind !== "AUDIO") thumbKey = await makeThumb(keyPath(key), t.kind, user.id, info.durationSec).catch(() => null);
      const asset = await db.mediaAsset.create({
        data: {
          userId: user.id, projectId: project.id, kind: t.kind, name, originalName: name, storageKey: key, thumbnailKey: thumbKey, mimeType: type, sizeBytes: BigInt(size),
          durationSec: t.kind === "IMAGE" ? null : info.durationSec, width: t.kind === "AUDIO" ? null : shown?.w ?? null, height: t.kind === "AUDIO" ? null : shown?.h ?? null, fps: t.kind === "VIDEO" ? info.video?.fps ?? null : null,
          hasAudio: Boolean(info.audio), metadata: { format: info.formatName, video: info.video ?? null, audio: info.audio ?? null } as Prisma.InputJsonValue,
        },
      });
      return json({ asset: publicAsset(asset) }, 201);
    } catch (e) {
      await rm(keyPath(key), { force: true });
      if (thumbKey) await rm(keyPath(thumbKey), { force: true });
      throw e;
    }
  },
  { rate: RATE.upload, rateKey: "upload" },
);
