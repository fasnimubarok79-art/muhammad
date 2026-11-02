import { z } from "zod";
import { db } from "@/lib/db";
import { ownedProject } from "@/lib/access";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validators";

type P = { id: string };

export const GET = authedRoute<P>(async ({ user, params }) => {
  const project = await ownedProject(user.id, idSchema.parse(params.id));
  const sources = await db.sourceVideo.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, kind: true, platform: true, sourceUrl: true, accessState: true, accessReason: true, embedUrl: true, originalName: true,
      durationSec: true, width: true, height: true, fps: true, hasAudio: true, sizeBytes: true, createdAt: true, storageKey: true,
      transcript: { select: { language: true, engine: true } },
    },
  });
  return json({
    project,
    sources: sources.map(({ storageKey, ...s }) => ({ ...s, hasMedia: Boolean(storageKey) })),
  });
});

const Patch = z.object({ title: z.string().trim().min(1).max(120) });

export const PATCH = authedRoute<P>(
  async ({ req, user, params }) => {
    const project = await ownedProject(user.id, idSchema.parse(params.id));
    const { title } = await parseJson(req, Patch);
    return json({ project: await db.project.update({ where: { id: project.id }, data: { title } }) });
  },
  { rate: RATE.write },
);
