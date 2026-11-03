import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { idSchema } from "@/lib/validators";

export const GET = authedRoute(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const kind = sp.get("kind");
  const take = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 30)));
  const jobs = await db.renderJob.findMany({
    where: { userId: user.id, ...(projectId ? { projectId: idSchema.parse(projectId) } : {}), ...(kind === "RENDER" || kind === "ANALYZE" ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: { clip: { select: { title: true } }, sourceVideo: { select: { originalName: true } } },
  });
  return json({ jobs: jobs.map(({ clip, sourceVideo, ...j }) => ({ ...publicJob(j), clipTitle: clip?.title ?? null, sourceName: sourceVideo?.originalName ?? null, updatedAt: j.updatedAt })) });
});
