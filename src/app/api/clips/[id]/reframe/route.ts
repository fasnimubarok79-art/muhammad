import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { ApiError, authedRoute, json } from "@/lib/http";
import { detectFaceTrack, trackCovers } from "@/lib/media/faces";
import { ProcessError } from "@/lib/media/exec";
import { keyPath } from "@/lib/storage";
import { idSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Face detection for the whole clip (cached on the clip). Used by the editor preview and by renders. */
export const POST = authedRoute<{ id: string }>(
  async ({ user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    if (!clip.sourceVideo.storageKey) throw new ApiError(409, "NO_MEDIA", "The source media is not available");
    if (trackCovers(clip.faceTrack, clip.startSec, clip.endSec)) return json({ track: clip.faceTrack, cached: true });
    try {
      const track = await detectFaceTrack(keyPath(clip.sourceVideo.storageKey), clip.startSec, clip.endSec);
      await db.clip.update({ where: { id: clip.id }, data: { faceTrack: track as unknown as Prisma.InputJsonValue } });
      return json({ track, cached: false });
    } catch (e) {
      if (e instanceof ProcessError) throw new ApiError(503, "FACE_DETECTION_UNAVAILABLE", "Face detection is not available on the server (install opencv-python-headless in the worker venv).");
      throw e;
    }
  },
  { rate: { limit: 10, windowMs: 60_000 }, rateKey: "reframe" },
);
