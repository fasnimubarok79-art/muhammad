import { z } from "zod";
import { db } from "@/lib/db";
import { ownedProject } from "@/lib/access";
import { defaultProbe, inspectLink } from "@/lib/connectors";
import { env } from "@/lib/env";
import { authedRoute, json, parseJson } from "@/lib/http";
import { enqueueAnalyze, publicJob } from "@/lib/jobs";
import { RATE } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validators";

const Body = z.object({ projectId: idSchema, url: z.string().min(4).max(2048) });

/**
 * Universal link import: detect platform -> validate URL (SSRF-safe) -> decide access state.
 * Only PROCESSABLE sources get a processing job; the others return the reason and next action.
 */
export const POST = authedRoute(
  async ({ req, user }) => {
    const body = await parseJson(req, Body);
    const project = await ownedProject(user.id, body.projectId);
    const result = await inspectLink(body.url, { probe: defaultProbe, metaAppToken: env().META_APP_TOKEN });
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
