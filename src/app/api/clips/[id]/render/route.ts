import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { audit } from "@/lib/audit";
import { ApiError, authedRoute, json, parseJson } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { PRESETS } from "@/lib/media/render";
import { RATE } from "@/lib/rate-limit";
import { renderCost, reserve } from "@/lib/tokens";
import { idemKeySchema, idSchema } from "@/lib/validators";

type P = { id: string };

const Params = z.object({
  resolution: z.enum(["450p", "720p", "1080p"]).default("1080p"),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  framing: z.enum(["blur", "crop", "pad", "follow"]).default("blur"),
  cropX: z.number().min(0).max(1).default(0.5),
  preset: z.enum(Object.keys(PRESETS) as [keyof typeof PRESETS, ...Array<keyof typeof PRESETS>]).default("viral_short"),
  removeSilence: z.boolean().default(false),
  burnSubtitles: z.boolean().default(true),
  trimStart: z.number().min(0).optional(),
  trimEnd: z.number().positive().optional(),
  style: z
    .object({
      preset: z.enum(["karaoke", "clean", "pop", "impact", "punch"]),
      fontSize: z.number().int().min(40).max(160),
      primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      highlight: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      outline: z.number().min(0).max(16),
      shadow: z.number().min(0).max(12),
      marginV: z.number().int().min(300).max(1500),
      maxCharsPerLine: z.number().int().min(10).max(40),
    })
    .partial()
    .optional(),
});

/** Price quote shown before the user confirms. */
export const GET = authedRoute<P>(async ({ req, user, params }) => {
  await ownedClip(user.id, idSchema.parse(params.id));
  const res = z.enum(["450p", "720p", "1080p"]).catch("1080p").parse(req.nextUrl.searchParams.get("resolution"));
  return json({ quote: renderCost(res, user.role), balance: user.tokenBalance });
});

const Body = z.object({ idempotencyKey: idemKeySchema, params: Params, confirmTotal: z.number().int().min(0) });

export const POST = authedRoute<P>(
  async ({ req, user, params, ip }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const body = await parseJson(req, Body);
    if (!clip.sourceVideo.storageKey) throw new ApiError(409, "NO_MEDIA", "The source media is not available");
    const len = clip.endSec - clip.startSec;
    if (body.params.trimEnd !== undefined && body.params.trimEnd > len + 0.01) throw new ApiError(400, "BAD_TRIM", "Trim end is outside the clip");

    const existing = await db.renderJob.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: body.idempotencyKey } } });
    if (existing) return json({ job: publicJob(existing), duplicate: true });

    const quote = renderCost(body.params.resolution, user.role);
    // The client must confirm the exact price it showed; a changed price is rejected, never silently charged.
    if (body.confirmTotal !== quote.charged) throw new ApiError(409, "PRICE_CHANGED", "The price changed. Review the cost and confirm again.", { quote });

    try {
      const job = await db.$transaction(async (tx) => {
        const job = await tx.renderJob.create({
          data: {
            userId: user.id, projectId: clip.projectId, clipId: clip.id, sourceVideoId: clip.sourceVideoId, kind: "RENDER",
            params: body.params as Prisma.InputJsonValue, tokenCost: quote.charged, idempotencyKey: body.idempotencyKey,
          },
        });
        await reserve(tx, user, quote.charged, `Render ${body.params.resolution} ${body.params.aspect}`, job.id, `render:${body.idempotencyKey}`);
        await audit("render.requested", { userId: user.id, target: job.id, ip, meta: { cost: quote.charged, resolution: body.params.resolution } }, tx);
        return job;
      });
      return json({ job: publicJob(job), charged: quote.charged }, 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await db.renderJob.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: body.idempotencyKey } } });
        if (again) return json({ job: publicJob(again), duplicate: true });
      }
      throw e;
    }
  },
  { rate: RATE.write, rateKey: "render" },
);
