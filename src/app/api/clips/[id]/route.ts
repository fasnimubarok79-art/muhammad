import { z } from "zod";
import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { hashtagsFrom } from "@/lib/media/clipping";
import { buildSegments, sliceWords, type Word } from "@/lib/media/subtitles";
import type { Prisma } from "@prisma/client";
import { idSchema } from "@/lib/validators";

type P = { id: string };

export const GET = authedRoute<P>(async ({ user, params }) => {
  const clip = await ownedClip(user.id, idSchema.parse(params.id));
  const segments = await db.subtitleSegment.findMany({ where: { clipId: clip.id }, orderBy: { idx: "asc" } });
  const text = segments.map((s) => s.text).join(" ");
  const { sourceVideo: s, thumbnailKey, ...rest } = clip;
  const analysis = (s.analysis ?? { silences: [] }) as { silences?: Array<{ start: number; end: number }> };
  const silences = (analysis.silences ?? [])
    .map((x) => ({ start: Math.max(0, x.start - clip.startSec), end: Math.min(clip.endSec - clip.startSec, x.end - clip.startSec) }))
    .filter((x) => x.end - x.start > 0.05);
  return json({
    silences,
    clip: { ...rest, duration: clip.endSec - clip.startSec, hasThumbnail: Boolean(thumbnailKey) },
    source: { id: s.id, durationSec: s.durationSec, width: s.width, height: s.height, fps: s.fps, hasAudio: s.hasAudio, platform: s.platform },
    segments: segments.map((g) => ({ id: g.id, idx: g.idx, start: g.startSec, end: g.endSec, text: g.text, words: g.wordsJson })),
    suggestions: { hashtags: hashtagsFrom(text), basis: "Recurring words in this clip's transcript" },
  });
});

const Patch = z
  .object({
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().max(2000),
    favorite: z.boolean(),
    status: z.enum(["candidate", "accepted", "rejected"]),
    startSec: z.number().min(0),
    endSec: z.number().positive(),
    editConfig: z.record(z.unknown()),
  })
  .partial();

export const PATCH = authedRoute<P>(
  async ({ req, user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const body = await parseJson(req, Patch);
    const start = body.startSec ?? clip.startSec;
    const end = body.endSec ?? clip.endSec;
    const max = clip.sourceVideo.durationSec ?? 0;
    if (!(end > start + 0.5) || end > max + 0.01) {
      return json({ error: { code: "BAD_RANGE", message: `Clip range must be inside the source (0 to ${max.toFixed(2)}s) and at least 0.5s long` } }, 400);
    }
    const rangeChanged = Math.abs(start - clip.startSec) > 0.001 || Math.abs(end - clip.endSec) > 0.001;
    const updated = await db.$transaction(async (tx) => {
      const c = await tx.clip.update({
        where: { id: clip.id },
        data: { ...body, editConfig: body.editConfig as Prisma.InputJsonValue | undefined, ...(rangeChanged ? { transcriptRef: `${start.toFixed(2)}-${end.toFixed(2)}` } : {}) },
      });
      if (rangeChanged) {
        // subtitle times are clip-relative: rebuild them from the real transcript for the new range
        const t = await tx.transcript.findUnique({ where: { sourceVideoId: clip.sourceVideoId } });
        await tx.subtitleSegment.deleteMany({ where: { clipId: clip.id } });
        if (t) {
          const segs = buildSegments(sliceWords(t.wordsJson as unknown as Word[], start, end));
          await tx.subtitleSegment.createMany({
            data: segs.map((g, i) => ({ clipId: clip.id, idx: i, startSec: g.start, endSec: g.end, text: g.text, wordsJson: g.words as unknown as Prisma.InputJsonValue })),
          });
        }
      }
      return c;
    });
    return json({ clip: { ...updated, thumbnailKey: undefined } });
  },
  { rate: RATE.write },
);
