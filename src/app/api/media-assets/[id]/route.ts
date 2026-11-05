import { rm } from "node:fs/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, authedRoute, json, notFound, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { keyPath } from "@/lib/storage";
import { idSchema } from "@/lib/validators";
import { publicAsset } from "@/lib/media/assets";

type P = { id: string };

async function owned(userId: string, id: string) {
  const a = await db.mediaAsset.findFirst({ where: { id, userId }, include: { _count: { select: { items: true } } } });
  if (!a) throw notFound("Media");
  return a;
}

const Patch = z.object({ name: z.string().trim().min(1).max(120) });

export const PATCH = authedRoute<P>(
  async ({ req, user, params }) => {
    const a = await owned(user.id, idSchema.parse(params.id));
    const { name } = await parseJson(req, Patch);
    const u = await db.mediaAsset.update({ where: { id: a.id }, data: { name }, include: { _count: { select: { items: true } } } });
    return json({ asset: publicAsset(u) });
  },
  { rate: RATE.write },
);

/** Delete a library file. Refused while any timeline uses it; the file goes only after the row is gone. */
export const DELETE = authedRoute<P>(
  async ({ user, params }) => {
    const a = await owned(user.id, idSchema.parse(params.id));
    const uses = await db.timelineItem.findMany({ where: { mediaAssetId: a.id }, select: { track: { select: { timeline: { select: { clipId: true, name: true } } } } } });
    if (uses.length) {
      const clips = [...new Map(uses.map((u) => [u.track.timeline.clipId, u.track.timeline.name])).entries()].map(([clipId, name]) => ({ clipId, name }));
      throw new ApiError(409, "IN_USE", `This file is used ${uses.length} ${uses.length === 1 ? "time" : "times"} in ${clips.length} ${clips.length === 1 ? "clip" : "clips"}. Remove it from those timelines first.`, { clips });
    }
    await db.mediaAsset.delete({ where: { id: a.id } });
    // another row never shares a storage key (keys are random per upload), so the file is free now
    await rm(keyPath(a.storageKey), { force: true });
    if (a.thumbnailKey) await rm(keyPath(a.thumbnailKey), { force: true });
    return json({ deleted: true });
  },
  { rate: RATE.write },
);
