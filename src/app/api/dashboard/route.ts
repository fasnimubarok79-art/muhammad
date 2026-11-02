import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";
import { ACTIVE_STATES, publicJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** All numbers come from the database for the signed-in user. */
export const GET = authedRoute(async ({ user }) => {
  const mine = { userId: user.id };
  const [analyzed, projects, uploads, clips, active, recentRenders, activity, balance] = await Promise.all([
    db.sourceVideo.aggregate({ where: { project: mine, transcript: { isNot: null } }, _count: { _all: true }, _sum: { durationSec: true } }),
    db.project.count({ where: mine }),
    db.sourceVideo.count({ where: { project: mine, storageKey: { not: null } } }),
    db.clip.count({ where: { project: mine } }),
    db.renderJob.findMany({ where: { ...mine, status: { in: [...ACTIVE_STATES] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.renderJob.findMany({ where: { ...mine, kind: "RENDER", status: "completed" }, orderBy: { finishedAt: "desc" }, take: 6, include: { clip: { select: { title: true } } } }),
    db.renderJob.findMany({ where: mine, orderBy: { createdAt: "desc" }, take: 12, include: { clip: { select: { title: true } }, sourceVideo: { select: { originalName: true, platform: true } } } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenBalance: true, role: true } }),
  ]);
  return json({
    stats: { projects, uploads, clips, activeJobs: active.length, videosAnalyzed: analyzed._count._all, minutesProcessed: Math.round(((analyzed._sum.durationSec ?? 0) / 60) * 10) / 10 },
    tokens: { balance: balance.tokenBalance, unlimited: balance.role === "OWNER_ADMIN" },
    activeJobs: active.map(publicJob),
    recentRenders: recentRenders.map((j) => ({ ...publicJob(j), clipTitle: j.clip?.title ?? null })),
    activity: activity.map((j) => ({ ...publicJob(j), clipTitle: j.clip?.title ?? null, sourceName: j.sourceVideo?.originalName ?? j.sourceVideo?.platform ?? null })),
  });
});
