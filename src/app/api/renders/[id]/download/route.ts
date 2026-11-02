import { db } from "@/lib/db";
import { ownedJob } from "@/lib/access";
import { audit } from "@/lib/audit";
import { ApiError, authedRoute, json } from "@/lib/http";
import { streamFile } from "@/lib/media-stream";
import { RATE } from "@/lib/rate-limit";
import { keyPath } from "@/lib/storage";
import { chargeDownload, downloadCost } from "@/lib/tokens";
import { idSchema } from "@/lib/validators";

export const runtime = "nodejs";
type P = { id: string };

async function completedJob(userId: string, id: string) {
  const job = await ownedJob(userId, idSchema.parse(id));
  if (job.kind !== "RENDER" || job.status !== "completed" || !job.outputKey) throw new ApiError(409, "NOT_READY", "This render is not finished");
  return job;
}

/** Step 1 (POST, CSRF-protected): pay for the download once. Repeats are free. */
export const POST = authedRoute<P>(
  async ({ user, params, ip }) => {
    const job = await completedJob(user.id, params.id);
    const r = await chargeDownload(user, job.id);
    if (r.charged) await audit("download.charged", { userId: user.id, target: job.id, ip, meta: { cost: r.charged } });
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenBalance: true } });
    return json({ ok: true, ...r, balance: u.tokenBalance, url: `/api/renders/${job.id}/download` });
  },
  { rate: RATE.write, rateKey: "download" },
);

/** Step 2 (GET): stream the file as an attachment, only after step 1 succeeded. */
export const GET = authedRoute<P>(
  async ({ req, user, params }) => {
    const job = await completedJob(user.id, params.id);
    const paid = await db.tokenTransaction.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: `download:${job.id}` } } });
    if (!paid) throw new ApiError(402, "PAYMENT_REQUIRED", "Confirm the download first", { cost: downloadCost(user.role) });
    return streamFile(req, keyPath(job.outputKey!), "video/mp4", `clipkita-${job.id}.mp4`);
  },
  { rate: RATE.read, rateKey: "download-get" },
);
