import { z } from "zod";
import { db } from "@/lib/db";
import { ownedProject } from "@/lib/access";
import { ApiError, authedRoute, json, parseJson } from "@/lib/http";
import { audit } from "@/lib/audit";
import { ACTIVE_STATES } from "@/lib/jobs";
import { keyPath } from "@/lib/storage";
import { rm } from "node:fs/promises";
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

/** Delete a project with its videos, clips, renders and their files. Refused while jobs are running. */
export const DELETE = authedRoute<P>(
  async ({ req, user, params, ip }) => {
    const project = await ownedProject(user.id, idSchema.parse(params.id));
    if (req.nextUrl.searchParams.get("confirm") !== project.title) throw new ApiError(400, "CONFIRM_REQUIRED", "Type the project name to confirm deletion");
    const running = await db.renderJob.count({ where: { projectId: project.id, status: { in: [...ACTIVE_STATES] } } });
    if (running) throw new ApiError(409, "JOBS_RUNNING", "Wait for or cancel the running jobs first");
    const [sources, clips, jobs] = await Promise.all([
      db.sourceVideo.findMany({ where: { projectId: project.id }, select: { storageKey: true } }),
      db.clip.findMany({ where: { projectId: project.id }, select: { thumbnailKey: true } }),
      db.renderJob.findMany({ where: { projectId: project.id }, select: { outputKey: true } }),
    ]);
    const keys = [...sources.map((s) => s.storageKey), ...clips.map((c) => c.thumbnailKey), ...jobs.map((j) => j.outputKey)].filter((k): k is string => Boolean(k));
    await db.project.delete({ where: { id: project.id } }); // cascades to sources, clips, segments, jobs
    let removed = 0;
    for (const k of keys) {
      try {
        await rm(keyPath(k), { force: true });
        removed++;
      } catch {}
    }
    await audit("project.delete", { userId: user.id, target: project.id, ip, meta: { files: removed } });
    return json({ ok: true, filesRemoved: removed });
  },
  { rate: RATE.write },
);
