import { env } from "../env";
import { run } from "./exec";
import { probe, type ProbeResult } from "./probe";
import { ensureDirFor, keyPath, newKey } from "../storage";

/** Accepted library uploads by MIME type. */
export const ASSET_TYPES: Record<string, { kind: "VIDEO" | "AUDIO" | "IMAGE"; ext: string }> = {
  "video/mp4": { kind: "VIDEO", ext: "mp4" },
  "video/quicktime": { kind: "VIDEO", ext: "mov" },
  "video/webm": { kind: "VIDEO", ext: "webm" },
  "video/x-matroska": { kind: "VIDEO", ext: "mkv" },
  "audio/mpeg": { kind: "AUDIO", ext: "mp3" },
  "audio/wav": { kind: "AUDIO", ext: "wav" },
  "audio/x-wav": { kind: "AUDIO", ext: "wav" },
  "audio/mp4": { kind: "AUDIO", ext: "m4a" },
  "audio/x-m4a": { kind: "AUDIO", ext: "m4a" },
  "audio/aac": { kind: "AUDIO", ext: "aac" },
  "audio/ogg": { kind: "AUDIO", ext: "ogg" },
  "image/png": { kind: "IMAGE", ext: "png" },
  "image/jpeg": { kind: "IMAGE", ext: "jpg" },
  "image/webp": { kind: "IMAGE", ext: "webp" },
};

/** Check that the file really is what its type says, using ffprobe. Returns null when it is not. */
export async function inspectAsset(file: string, kind: "VIDEO" | "AUDIO" | "IMAGE"): Promise<ProbeResult | null> {
  const info = await probe(env().FFPROBE_PATH, file).catch(() => null);
  if (!info) return null;
  if (kind === "VIDEO" && (!info.video || !(info.durationSec > 0))) return null;
  if (kind === "AUDIO" && (!info.audio || !(info.durationSec > 0))) return null;
  if (kind === "IMAGE" && !(info.video && info.video.width > 0 && info.video.height > 0)) return null;
  return info;
}

/** A small JPEG preview from a real frame (video: about 1 s in; image: the picture itself). */
export async function makeThumb(file: string, kind: "VIDEO" | "IMAGE", userId: string, durationSec: number) {
  const key = newKey("thumbs", userId, "jpg");
  await ensureDirFor(key);
  const at = kind === "VIDEO" ? ["-ss", Math.min(1, durationSec / 2).toFixed(3)] : [];
  await run(env().FFMPEG_PATH, ["-hide_banner", "-nostdin", "-y", ...at, "-i", file, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", keyPath(key)], { timeoutMs: 60_000 });
  return key;
}

/** What the client may see about a library file (no storage paths). */
export const publicAsset = (a: { id: string; projectId: string | null; kind: string; name: string; mimeType: string; sizeBytes: bigint; durationSec: number | null; width: number | null; height: number | null; fps: number | null; hasAudio: boolean; thumbnailKey: string | null; createdAt: Date; _count?: { items: number } }) => ({
  id: a.id, projectId: a.projectId, kind: a.kind, name: a.name, mimeType: a.mimeType, sizeBytes: Number(a.sizeBytes), durationSec: a.durationSec, width: a.width, height: a.height, fps: a.fps, hasAudio: a.hasAudio,
  url: `/api/media/asset/${a.id}`, thumbUrl: a.thumbnailKey ? `/api/media/asset-thumb/${a.id}` : null, createdAt: a.createdAt, usedBy: a._count?.items ?? 0,
});
