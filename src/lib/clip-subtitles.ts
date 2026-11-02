import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { buildSegments, sliceWords, type Segment, type Word } from "./media/subtitles";

/** Keep model word timing when the text is unchanged; otherwise spread words evenly (marked p:-1). */
export function normaliseSegment(s: { start: number; end: number; text: string; words?: Word[] }): Segment {
  const text = s.text.replace(/\s+/g, " ").trim();
  const parts = text.split(" ");
  const same = s.words && s.words.length === parts.length && s.words.every((w, i) => w.w === parts[i]);
  if (same) return { start: s.start, end: s.end, text, words: s.words!.map((w) => ({ ...w, s: Math.max(s.start, w.s), e: Math.min(s.end, w.e) })) };
  const step = (s.end - s.start) / parts.length;
  return { start: s.start, end: s.end, text, words: parts.map((w, i) => ({ w, s: s.start + i * step, e: s.start + (i + 1) * step, p: -1 })) };
}

export async function replaceSegments(clipId: string, segs: Segment[]) {
  await db.$transaction([
    db.subtitleSegment.deleteMany({ where: { clipId } }),
    db.subtitleSegment.createMany({
      data: segs.map((g, i) => ({ clipId, idx: i, startSec: g.start, endSec: g.end, text: g.text, wordsJson: g.words as unknown as Prisma.InputJsonValue })),
    }),
  ]);
}

/** Auto Caption: rebuild segments from the stored real transcript. Returns null when there is none. */
export async function regenerateFromTranscript(clip: { id: string; sourceVideoId: string; startSec: number; endSec: number }) {
  const t = await db.transcript.findUnique({ where: { sourceVideoId: clip.sourceVideoId } });
  if (!t) return null;
  const segs = buildSegments(sliceWords(t.wordsJson as unknown as Word[], clip.startSec, clip.endSec));
  await replaceSegments(clip.id, segs);
  return segs;
}
