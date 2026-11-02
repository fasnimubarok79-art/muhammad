import { z } from "zod";
import { db } from "@/lib/db";
import { ownedClip } from "@/lib/access";
import { normaliseSegment, regenerateFromTranscript, replaceSegments } from "@/lib/clip-subtitles";
import { ApiError, authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validators";

type P = { id: string };

export const GET = authedRoute<P>(async ({ user, params }) => {
  const clip = await ownedClip(user.id, idSchema.parse(params.id));
  const segs = await db.subtitleSegment.findMany({ where: { clipId: clip.id }, orderBy: { idx: "asc" } });
  return json({ segments: segs.map((g) => ({ id: g.id, start: g.startSec, end: g.endSec, text: g.text, words: g.wordsJson })) });
});

const Word = z.object({ w: z.string().max(100), s: z.number(), e: z.number(), p: z.number().optional() });
const Body = z.object({
  segments: z
    .array(z.object({ start: z.number().min(0), end: z.number().positive(), text: z.string().trim().min(1).max(300), words: z.array(Word).max(100).optional() }))
    .max(2000),
});

/** Save edited subtitles (text, timing, added or removed segments). */
export const PUT = authedRoute<P>(
  async ({ req, user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const { segments } = await parseJson(req, Body);
    const len = clip.endSec - clip.startSec;
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    sorted.forEach((s, i) => {
      if (!(s.end > s.start) || s.end > len + 0.01) throw new ApiError(400, "BAD_TIMING", `Segment ${i + 1} must be inside the clip (0 to ${len.toFixed(2)}s)`);
    });
    const segs = sorted.map(normaliseSegment);
    await replaceSegments(clip.id, segs);
    return json({ ok: true, count: segs.length });
  },
  { rate: RATE.write },
);

/** Auto Caption: rebuild from the real transcript. */
export const POST = authedRoute<P>(
  async ({ user, params }) => {
    const clip = await ownedClip(user.id, idSchema.parse(params.id));
    const segs = await regenerateFromTranscript(clip);
    if (!segs) throw new ApiError(409, "NO_TRANSCRIPT", "This source has no transcript yet. Run the analysis first.");
    return json({ ok: true, count: segs.length });
  },
  { rate: RATE.write },
);
