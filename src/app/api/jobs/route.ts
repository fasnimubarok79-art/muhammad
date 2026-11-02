import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { idSchema } from "@/lib/validators";

export const GET = authedRoute(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const take = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 30)));
  const jobs = await db.renderJob.findMany({
    where: { userId: user.id, ...(projectId ? { projectId: idSchema.parse(projectId) } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
  return json({ jobs: jobs.map(publicJob) });
});
