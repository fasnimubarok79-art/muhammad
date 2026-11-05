import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { audit } from "@/lib/audit";
import { ApiError, authedRoute, json, parseJson } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { cardsSchema } from "@/lib/media/cards";
import { PRESETS } from "@/lib/media/render";
import { RATE } from "@/lib/rate-limit";
import { renderCost, reserve } from "@/lib/tokens";
import { idemKeySchema, idSchema } from "@/lib/validators";

type P = Record<string, never>;

const ClipRender = z.object({
  clipId: idSchema,
  params: z.object({
    resolution: z.enum(["450p", "720p", "1080p"]).default("1080p"),
    aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    framing: z.enum(["blur", "crop", "pad", "follow"]).default("blur"),
    cropX: z.number().min(0).max(1).default(0.5),
    preset: z.enum(Object.keys(PRESETS) as [keyof typeof PRESETS, ...Array<keyof typeof PRESETS>]).default("viral_short"),
    removeSilence: z.boolean().default(false),
    burnSubtitles: z.boolean().default(true),
    trimStart: z.number().min(0).optional(),
    trimEnd: z.number().positive().optional(),
    cards: cardsSchema.optional(),
    style: z
      .object({
        preset: z.enum(["karaoke", "clean", "pop", "impact", "punch", "hormozi"]),
        fontSize: z.number().int().min(40).max(160),
        primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        highlight: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        outline: z.number().min(0).max(16),
        shadow: z.number().min(0).max(12),
        marginV: z.number().int().min(300).max(1500),
        maxCharsPerLine: z.number().int().min(10).max(40),
        bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        popScale: z.number().min(1).max(2).optional(),
      })
      .partial()
      .optional(),
  }),
});

const Body = z.object({
  idempotencyKey: idemKeySchema,
  clips: z.array(ClipRender).min(1).max(20),
  confirmTotal: z.number().int().min(0).optional(),
});

/**
 * Batch export: queue multiple clip renders in one transaction.
 * Each clip gets its own render job and idempotency key; tokens are reserved
 * for the total cost up front. If any clip fails validation, nothing is queued.
 */
export const POST = authedRoute<P>(
  async ({ req, user, ip }) => {
    const body = await parseJson(req, Body);

    // Guard: batch render idempotency prevents duplicate batch submissions.
    const existing = await db.renderJob.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: body.idempotencyKey } },
    });
    if (existing) return json({ job: publicJob(existing), duplicate: true, batch: true });

    // Validate all clips up front and compute the total token cost.
    const validated: Array<{ clip: Awaited<ReturnType<typeof ownedClip>>; params: z.infer<typeof ClipRender>["params"]; quote: ReturnType<typeof renderCost> }> = [];
    let totalCharged = 0;
    for (const c of body.clips) {
      const clip = await ownedClip(user.id, c.clipId);
      if (!clip.sourceVideo.storageKey) throw new ApiError(409, "NO_MEDIA", `Clip ${clip.id} has no source media`);
      const len = clip.endSec - clip.startSec;
      if (c.params.trimEnd !== undefined && c.params.trimEnd > len + 0.01) {
        throw new ApiError(400, "BAD_TRIM", `Clip ${clip.id}: trim end is outside the clip`);
      }
      const quote = renderCost(c.params.resolution, user.role);
      totalCharged += quote.charged;
      validated.push({ clip, params: c.params, quote });
    }

    // The client must confirm the exact total price.
    if (body.confirmTotal !== undefined && body.confirmTotal !== totalCharged) {
      throw new ApiError(409, "PRICE_CHANGED", "The batch price changed. Review the cost and confirm again.", { totalCharged });
    }

    const jobs = await db.$transaction(async (tx) => {
      const created: Array<{ job: typeof publicJob extends (j: infer I) => infer O ? O : never; charged: number }> = [];
      for (const v of validated) {
        const job = await tx.renderJob.create({
          data: {
            userId: user.id,
            projectId: v.clip.projectId,
            clipId: v.clip.id,
            sourceVideoId: v.clip.sourceVideoId,
            kind: "RENDER",
            params: v.params as Prisma.InputJsonValue,
            tokenCost: v.quote.charged,
            idempotencyKey: `${body.idempotencyKey}:${v.clip.id}`,
          },
        });
        await reserve(tx, user, v.quote.charged, `Batch render ${v.params.resolution} ${v.params.aspect}`, job.id, `batch:${body.idempotencyKey}:${v.clip.id}`);
        await audit("batch.render.requested", { userId: user.id, target: job.id, ip, meta: { cost: v.quote.charged, resolution: v.params.resolution, clipId: v.clip.id } }, tx);
        created.push({ job: publicJob(job), charged: v.quote.charged });
      }
      return created;
    });

    return json(
      {
        batchId: body.idempotencyKey,
        totalCharged,
        jobs: jobs.map((j) => ({ job: j.job, charged: j.charged })),
      },
      201,
    );
  },
  { rate: RATE.write, rateKey: "batch-render" },
);
