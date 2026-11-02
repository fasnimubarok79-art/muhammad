import { db } from "@/lib/db";
import { ownedJob } from "@/lib/access";
import { ApiError, authedRoute, json } from "@/lib/http";
import { ACTIVE_STATES } from "@/lib/jobs";
import { refund } from "@/lib/tokens";
import { idSchema } from "@/lib/validators";

export const POST = authedRoute<{ id: string }>(async ({ user, params }) => {
  const job = await ownedJob(user.id, idSchema.parse(params.id));
  const r = await db.renderJob.updateMany({ where: { id: job.id, status: { in: [...ACTIVE_STATES] } }, data: { status: "cancelled", finishedAt: new Date(), error: "Cancelled by user" } });
  if (r.count === 0) throw new ApiError(409, "NOT_ACTIVE", "This job is no longer running");
  // A queued job never reaches the worker, so refund here; running jobs are refunded by the worker as well (idempotent).
  const refunded = job.kind === "RENDER" ? await refund(user.id, job.id, "job cancelled") : 0;
  return json({ ok: true, refunded });
});
