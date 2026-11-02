import { ownedClip, ownedJob, ownedSource } from "@/lib/access";
import { authedRoute, notFound } from "@/lib/http";
import { mimeFor, streamFile } from "@/lib/media-stream";
import { RATE } from "@/lib/rate-limit";
import { keyPath } from "@/lib/storage";
import { idSchema } from "@/lib/validators";

export const runtime = "nodejs";

/** Inline, owner-only media: source video, clip thumbnail, or a render preview (free to watch). */
export const GET = authedRoute<{ kind: string; id: string }>(
  async ({ req, user, params }) => {
    const id = idSchema.parse(params.id);
    let key: string | null = null;
    if (params.kind === "source") key = (await ownedSource(user.id, id)).storageKey;
    else if (params.kind === "thumb") key = (await ownedClip(user.id, id)).thumbnailKey;
    else if (params.kind === "render") {
      const job = await ownedJob(user.id, id);
      key = job.status === "completed" ? job.outputKey : null;
    } else throw notFound("Media");
    if (!key) throw notFound("Media");
    return streamFile(req, keyPath(key), mimeFor(key));
  },
  { rate: RATE.read, rateKey: "media" },
);
