import { Prisma, type TrackType as DbTrackType } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../http";
import { CANVAS, defaultTimeline, pickFps } from "./defaults";
import { timelineEnd } from "./ops";
import { timelineSchema, type Item, type MediaInfo, type TimelineDoc } from "./schema";

/** Timeline persistence. Every function filters by the owner; the document is validated before writing. */

type Rows = Prisma.TimelineGetPayload<{ include: { tracks: { include: { items: true } }; markers: true } }>;

export function rowsToDoc(t: Rows): TimelineDoc {
  return {
    id: t.id,
    fps: t.fps as TimelineDoc["fps"],
    width: t.width,
    height: t.height,
    playheadFrame: t.playheadFrame,
    tracks: t.tracks.map((r) => ({ id: r.id, name: r.name, type: r.type, order: r.order, hidden: r.hidden, muted: r.muted, locked: r.locked, volume: r.volume })),
    items: t.tracks.flatMap((r) =>
      r.items.map(
        (i): Item => ({
          id: i.id, trackId: r.id, kind: i.kind as Item["kind"], mediaAssetId: i.mediaAssetId, sourceVideoId: i.sourceVideoId,
          startFrame: i.startFrame, durationFrames: i.durationFrames, sourceInFrame: i.sourceInFrame, speed: i.speed, opacity: i.opacity, volume: i.volume,
          transform: (i.transform as Item["transform"]) ?? null, effects: (i.effects as Item["effects"]) ?? null,
          keyframes: (i.keyframes as Item["keyframes"]) ?? [], text: (i.config as Item["text"]) ?? null,
        }),
      ),
    ),
    markers: t.markers.map((m) => ({ id: m.id, frame: m.frame, label: m.label, color: m.color })),
  };
}

const include = { tracks: { include: { items: true }, orderBy: { order: "asc" as const } }, markers: { orderBy: { frame: "asc" as const } } };

/** The clip's timeline, created from its saved settings the first time (idempotent under races). */
export async function loadOrCreateTimeline(userId: string, clipId: string) {
  const clip = await db.clip.findFirst({ where: { id: clipId, project: { userId } }, include: { sourceVideo: true } });
  if (!clip) throw new ApiError(404, "NOT_FOUND", "Clip not found");
  const found = await db.timeline.findUnique({ where: { clipId }, include });
  if (found) return { clip, row: found };
  const cfg = (clip.editConfig ?? {}) as { aspect?: "9:16" | "16:9" | "1:1"; trimStart?: number; trimEnd?: number; removeSilence?: boolean };
  const aspect = cfg.aspect && cfg.aspect in CANVAS ? cfg.aspect : "9:16";
  const silences = ((clip.sourceVideo.analysis ?? {}) as { silences?: Array<{ start: number; end: number }> }).silences ?? [];
  const doc = defaultTimeline({
    clip: { startSec: clip.startSec, endSec: clip.endSec, sourceVideoId: clip.sourceVideoId },
    sourceDurationSec: clip.sourceVideo.durationSec ?? clip.endSec,
    aspect, trimStart: cfg.trimStart, trimEnd: cfg.trimEnd, removeSilence: cfg.removeSilence, silences, fps: pickFps(clip.sourceVideo.fps),
  });
  try {
    await db.$transaction(async (tx) => {
      await tx.timeline.create({ data: { id: doc.id, projectId: clip.projectId, clipId: clip.id, name: clip.title.slice(0, 120), width: doc.width, height: doc.height, fps: doc.fps, durationFrames: timelineEnd(doc) } });
      await writeChildren(tx, doc);
    });
  } catch (e) {
    // a parallel request created it first
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  return { clip, row: await db.timeline.findUniqueOrThrow({ where: { clipId }, include }) };
}

async function writeChildren(tx: Prisma.TransactionClient, doc: TimelineDoc) {
  await tx.timelineTrack.createMany({ data: doc.tracks.map((t) => ({ ...t, type: t.type as DbTrackType, timelineId: doc.id })) });
  if (doc.items.length) {
    await tx.timelineItem.createMany({
      data: doc.items.map((i) => ({
        id: i.id, trackId: i.trackId, kind: i.kind, mediaAssetId: i.mediaAssetId, sourceVideoId: i.sourceVideoId,
        startFrame: i.startFrame, durationFrames: i.durationFrames, sourceInFrame: i.sourceInFrame, speed: i.speed, opacity: i.opacity, volume: i.volume,
        transform: (i.transform ?? Prisma.DbNull) as Prisma.InputJsonValue, effects: (i.effects ?? Prisma.DbNull) as Prisma.InputJsonValue,
        keyframes: i.keyframes as Prisma.InputJsonValue, config: (i.text ?? Prisma.DbNull) as Prisma.InputJsonValue,
      })),
    });
  }
  if (doc.markers.length) await tx.timelineMarker.createMany({ data: doc.markers.map((m) => ({ ...m, timelineId: doc.id })) });
}

/** Refuse references to media the user does not own; returns the media facts of every reference. */
export async function checkRefs(userId: string, doc: TimelineDoc) {
  const assetIds = [...new Set(doc.items.flatMap((i) => (i.mediaAssetId ? [i.mediaAssetId] : [])))];
  const sourceIds = [...new Set(doc.items.flatMap((i) => (i.sourceVideoId ? [i.sourceVideoId] : [])))];
  const [assets, sources] = await Promise.all([
    db.mediaAsset.findMany({ where: { id: { in: assetIds }, userId } }),
    db.sourceVideo.findMany({ where: { id: { in: sourceIds }, project: { userId }, storageKey: { not: null } } }),
  ]);
  if (assets.length !== assetIds.length || sources.length !== sourceIds.length) throw new ApiError(400, "BAD_MEDIA", "The timeline uses media that does not exist or is not yours");
  for (const i of doc.items) {
    const a = i.mediaAssetId ? assets.find((x) => x.id === i.mediaAssetId)! : null;
    if (a && ((i.kind === "image") !== (a.kind === "IMAGE") || (i.kind === "audio" && !a.hasAudio) || (i.kind === "video" && a.kind !== "VIDEO"))) throw new ApiError(400, "BAD_MEDIA", `Item ${i.id} does not match its media type`);
  }
  return { assets, sources };
}

export function mediaInfos(assets: Array<{ id: string; kind: string; name: string; durationSec: number | null; width: number | null; height: number | null; hasAudio: boolean; thumbnailKey: string | null }>, sources: Array<{ id: string; originalName: string | null; platform: string; durationSec: number | null; width: number | null; height: number | null; hasAudio: boolean | null }>): MediaInfo[] {
  return [
    ...assets.map((a) => ({ ref: `asset:${a.id}`, kind: a.kind as MediaInfo["kind"], name: a.name, durationSec: a.durationSec, width: a.width, height: a.height, hasAudio: a.hasAudio, url: `/api/media/asset/${a.id}`, thumbUrl: a.thumbnailKey ? `/api/media/asset-thumb/${a.id}` : null })),
    ...sources.map((s) => ({ ref: `source:${s.id}`, kind: "VIDEO" as const, name: s.originalName ?? s.platform, durationSec: s.durationSec, width: s.width, height: s.height, hasAudio: Boolean(s.hasAudio), url: `/api/media/source/${s.id}`, thumbUrl: null })),
  ];
}

/** Items must stay inside their media: a stored item never points past the end of its file. */
export function checkBounds(doc: TimelineDoc, media: MediaInfo[]) {
  const by = new Map(media.map((m) => [m.ref, m]));
  for (const i of doc.items) {
    const m = by.get(i.mediaAssetId ? `asset:${i.mediaAssetId}` : `source:${i.sourceVideoId}`);
    if (!m || m.kind === "IMAGE" || m.durationSec == null) continue;
    const needed = (i.sourceInFrame + i.durationFrames * i.speed) / doc.fps;
    if (needed > m.durationSec + 0.1) throw new ApiError(400, "OUT_OF_MEDIA", `Item ${i.id} runs past the end of ${m.name}`);
  }
}

/**
 * Replace the stored document in one transaction. `version` must be the version the editor loaded;
 * a different one means another tab or device saved in between and the save is refused (409).
 */
export async function saveTimeline(userId: string, clipId: string, version: number, input: unknown) {
  const current = await db.timeline.findFirst({ where: { clipId, project: { userId } }, select: { id: true, version: true } });
  if (!current) throw new ApiError(404, "NOT_FOUND", "Timeline not found");
  const parsed = timelineSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "BAD_TIMELINE", parsed.error.issues[0]?.message ?? "Invalid timeline");
  const doc = parsed.data;
  if (current.id !== doc.id) throw new ApiError(400, "BAD_TIMELINE", "Timeline id does not match this clip");
  const { assets, sources } = await checkRefs(userId, doc);
  checkBounds(doc, mediaInfos(assets, sources));
  return db.$transaction(async (tx) => {
    const bumped = await tx.timeline.updateMany({ where: { id: doc.id, version }, data: { version: { increment: 1 }, width: doc.width, height: doc.height, fps: doc.fps, playheadFrame: doc.playheadFrame, durationFrames: timelineEnd(doc) } });
    if (bumped.count !== 1) throw new ApiError(409, "VERSION_CONFLICT", "This timeline was saved from another tab or device. Reload it or keep your version.", { version: current.version });
    await tx.timelineMarker.deleteMany({ where: { timelineId: doc.id } });
    await tx.timelineTrack.deleteMany({ where: { timelineId: doc.id } }); // items cascade
    await writeChildren(tx, doc);
    return { version: version + 1 };
  });
}
