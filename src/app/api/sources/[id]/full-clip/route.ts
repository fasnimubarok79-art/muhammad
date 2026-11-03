import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ownedSource } from "@/lib/access";
import { ApiError, authedRoute, json } from "@/lib/http";
import { env } from "@/lib/env";
import { run } from "@/lib/media/exec";
import { ensureDirFor, keyPath, newKey } from "@/lib/storage";
import { buildSegments, sliceWords, type Word } from "@/lib/media/subtitles";
import { RATE } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validators";

/** Make one clip that covers the whole source video, with subtitles from its transcript. */
export const POST = authedRoute<{ id: string }>(
  async ({ user, params }) => {
    const src = await ownedSource(user.id, idSchema.parse(params.id));
    if (!src.storageKey || !src.durationSec) throw new ApiError(409, "NOT_READY", "Wait until the video has been analysed.");
    const existing = await db.clip.findFirst({ where: { sourceVideoId: src.id, startSec: 0, endSec: src.durationSec } });
    if (existing) return json({ clip: { id: existing.id }, existing: true });
    const t = await db.transcript.findUnique({ where: { sourceVideoId: src.id } });
    const words = t ? (t.wordsJson as unknown as Word[]) : [];
    const segs = buildSegments(sliceWords(words, 0, src.durationSec));
    const first = t?.text.split(/(?<=[.!?…])\s/)[0]?.trim() ?? "";
    const clip = await db.clip.create({
      data: {
        projectId: src.projectId,
        sourceVideoId: src.id,
        startSec: 0,
        endSec: src.durationSec,
        title: (first || src.originalName || "Full video").slice(0, 140),
        hookText: first ? first.slice(0, 160) : null,
        description: t?.text.slice(0, 2000) ?? null,
        transcriptRef: `0.00-${src.durationSec.toFixed(2)}`,
        status: "accepted",
        segments: { create: segs.map((g, i) => ({ idx: i, startSec: g.start, endSec: g.end, text: g.text, wordsJson: g.words as unknown as Prisma.InputJsonValue })) },
      },
    });
    // a real frame as thumbnail (best effort; the clip works without it)
    try {
      const tk = newKey("thumbs", user.id, "jpg");
      await ensureDirFor(tk);
      await run(env().FFMPEG_PATH, ["-hide_banner", "-nostdin", "-y", "-ss", Math.min(1, src.durationSec / 2).toFixed(2), "-i", keyPath(src.storageKey), "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", keyPath(tk)], { timeoutMs: 30_000 });
      await db.clip.update({ where: { id: clip.id }, data: { thumbnailKey: tk } });
    } catch {}
    return json({ clip: { id: clip.id }, existing: false }, 201);
  },
  { rate: RATE.write },
);
