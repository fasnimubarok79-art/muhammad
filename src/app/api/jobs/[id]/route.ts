import { ownedJob } from "@/lib/access";
import { authedRoute, json } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { idSchema } from "@/lib/validators";

export const GET = authedRoute<{ id: string }>(async ({ user, params }) => {
  return json({ job: publicJob(await ownedJob(user.id, idSchema.parse(params.id))) });
});
