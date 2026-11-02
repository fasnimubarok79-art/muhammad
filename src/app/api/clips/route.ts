import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";
import { idSchema } from "@/lib/validators";

const Query = z.object({
  projectId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["candidate", "accepted", "rejected"]).optional(),
  favorite: z.enum(["1"]).optional(),
  sort: z.enum(["score", "newest", "start", "duration"]).default("score"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});

export const GET = authedRoute(async ({ req, user }) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where: Prisma.ClipWhereInput = {
    project: { userId: user.id },
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.favorite ? { favorite: true } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const orderBy: Prisma.ClipOrderByWithRelationInput[] =
    q.sort === "newest" ? [{ createdAt: "desc" }] : q.sort === "start" ? [{ startSec: "asc" }] : q.sort === "duration" ? [{ endSec: "desc" }] : [{ score: { sort: "desc", nulls: "last" } }, { startSec: "asc" }];
  const [total, clips] = await Promise.all([
    db.clip.count({ where }),
    db.clip.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { _count: { select: { segments: true } }, jobs: { where: { kind: "RENDER" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, progress: true, outputKey: true } } },
    }),
  ]);
  return json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    clips: clips.map(({ thumbnailKey, jobs, ...c }) => ({
      ...c,
      duration: c.endSec - c.startSec,
      hasThumbnail: Boolean(thumbnailKey),
      latestRender: jobs[0] ? { id: jobs[0].id, status: jobs[0].status, progress: jobs[0].progress, hasOutput: Boolean(jobs[0].outputKey) } : null,
    })),
  });
});
