import { ownedSource } from "@/lib/access";
import { ApiError, authedRoute, json } from "@/lib/http";
import { enqueueAnalyze, publicJob } from "@/lib/jobs";
import { RATE } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validators";

/** Re-run AI analysis (Auto Clip / Reprocess). Favourites and accepted clips are kept. */
export const POST = authedRoute<{ id: string }>(
  async ({ user, params }) => {
    const src = await ownedSource(user.id, idSchema.parse(params.id));
    if (src.accessState !== "PROCESSABLE") throw new ApiError(409, "NOT_PROCESSABLE", src.accessReason ?? "This source cannot be processed");
    const job = await enqueueAnalyze(user.id, src.projectId, src.id);
    return json({ job: publicJob(job) }, 202);
  },
  { rate: RATE.import, rateKey: "analyze" },
);
