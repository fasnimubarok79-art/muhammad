import { z } from "zod";
import { db } from "@/lib/db";
import { ownedProject } from "@/lib/access";
import { defaultProbe, inspectLink } from "@/lib/connectors";
import { env } from "@/lib/env";
import { authedRoute, json, parseJson } from "@/lib/http";
import { enqueueAnalyze, publicJob } from "@/lib/jobs";
import { RATE } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { SOCIAL_PLATFORMS } from "@/lib/media/ytdlp";
import { ApiError } from "@/lib/http";
import { idSchema } from "@/lib/validators";

const Body = z.object({ projectId: idSchema, url: z.string().min(4).max(2048), rightsConfirmed: z.boolean().optional() });

/**
 * Universal link import: detect platform -> validate URL (SSRF-safe) -> decide access state.
 * Only PROCESSABLE sources get a processing job; the others return the reason and next action.
 */
export const POST = authedRoute(
  async ({ req, user, ip }) => {
    const body = await parseJson(req, Body);
    const project = await ownedProject(user.id, body.projectId);
    const result = await inspectLink(body.url, { probe: defaultProbe, metaAppToken: env().META_APP_TOKEN, linkImport: env().LINK_IMPORT === "1" });
    const social = result.accessState === "PROCESSABLE" && SOCIAL_PLATFORMS.has(result.platform);
    if (social && body.rightsConfirmed !== true) {
      // Nothing is created or downloaded until the user confirms they may use the video.
      throw new ApiError(400, "RIGHTS_REQUIRED", "Confirm that you own this video or have permission to use it.", { access: result });
    }
    if (social) await audit("import.rights_confirmed", { userId: user.id, target: result.normalizedUrl.slice(0, 300), ip });
    const source = await db.sourceVideo.create({
      data: {
        projectId: project.id,
        kind: "URL",
        platform: result.platform,
        sourceUrl: result.normalizedUrl,
        accessState: result.accessState,
        accessReason: result.reason,
        embedUrl: result.embedUrl,
        mimeType: result.meta?.contentType,
        sizeBytes: result.meta?.sizeBytes ? BigInt(result.meta.sizeBytes) : null,
      },
    });
    const job = result.accessState === "PROCESSABLE" ? await enqueueAnalyze(user.id, project.id, source.id) : null;
    return json({ source: { id: source.id }, access: result, job: job ? publicJob(job) : null }, 201);
  },
  { rate: RATE.import, rateKey: "import" },
);
