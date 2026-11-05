import type { WordCard } from "../media/cards";
import type { Segment, Word } from "../media/subtitles";
import { end, itemsOn, mainTrack } from "./ops";
import type { Item, TimelineDoc } from "./schema";

/**
 * Subtitles and word cards are anchored to the clip's source speech (clip-relative seconds, as stored
 * in SubtitleSegment and editConfig.cards). They are drawn where that speech lands on the timeline:
 * through the main-track items cut from the clip's source. Move or split those items and the captions
 * move with the words; cut a part away and its captions go with it.
 */

type Window = { item: Item; srcA: number; srcB: number; tlA: number; speed: number };

export function speechWindows(doc: TimelineDoc, sourceVideoId: string): Window[] {
  const main = mainTrack(doc);
  return itemsOn(doc, main.id)
    .filter((i) => i.kind === "video" && i.sourceVideoId === sourceVideoId)
    .map((i) => ({ item: i, srcA: i.sourceInFrame / doc.fps, srcB: (i.sourceInFrame + i.durationFrames * i.speed) / doc.fps, tlA: i.startFrame / doc.fps, speed: i.speed }));
}

/** Every timeline time (seconds) where source second `src` is played. */
export function srcToTimeline(doc: TimelineDoc, sourceVideoId: string, src: number): number[] {
  return speechWindows(doc, sourceVideoId).filter((w) => src >= w.srcA && src < w.srcB).map((w) => w.tlA + (src - w.srcA) / w.speed);
}

/** The source second played at timeline second `tl` on the main track, or null in a gap / other media. */
export function timelineToSrc(doc: TimelineDoc, sourceVideoId: string, tl: number): number | null {
  const f = tl * doc.fps;
  const w = speechWindows(doc, sourceVideoId).find((x) => f >= x.item.startFrame && f < end(x.item));
  return w ? w.srcA + (tl - w.tlA) * w.speed : null;
}

/** Map clip-relative subtitle segments onto the timeline (one copy per occurrence of their speech). */
export function mapSegments(doc: TimelineDoc, sourceVideoId: string, clipStartSec: number, segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const w of speechWindows(doc, sourceVideoId)) {
    const toTl = (src: number) => w.tlA + (src - w.srcA) / w.speed;
    for (const s of segs) {
      const a = clipStartSec + s.start;
      const b = clipStartSec + s.end;
      if (b <= w.srcA || a >= w.srcB) continue;
      const words: Word[] = s.words
        .map((x) => ({ ...x, s: clipStartSec + x.s, e: clipStartSec + x.e }))
        .filter((x) => x.e > w.srcA && x.s < w.srcB)
        .map((x) => ({ ...x, s: toTl(Math.max(x.s, w.srcA)), e: toTl(Math.min(x.e, w.srcB)) }))
        .filter((x) => x.e - x.s > 0.01);
      if (!words.length && s.words.length) continue;
      const start = toTl(Math.max(a, w.srcA));
      const stop = toTl(Math.min(b, w.srcB));
      if (stop - start < 0.05) continue;
      out.push({ start, end: stop, text: words.length ? words.map((x) => x.w).join(" ") : s.text, words });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Cards on the timeline: `start` in timeline seconds; cards whose moment was cut away are dropped. */
export function mapCards(doc: TimelineDoc, sourceVideoId: string, clipStartSec: number, cards: WordCard[]): Array<WordCard & { start: number }> {
  const total = Math.max(0, ...doc.items.map(end)) / doc.fps;
  return cards
    .flatMap((c) => srcToTimeline(doc, sourceVideoId, clipStartSec + c.at).map((start) => ({ ...c, start, dur: Math.min(c.dur, Math.max(0, total - start)) })))
    .filter((c) => c.dur > 0.1)
    .sort((a, b) => a.start - b.start);
}
