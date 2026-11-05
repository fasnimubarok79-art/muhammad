import { CARD_LOOKS, newCard, type WordCard } from "../media/cards";
import { keywordIndex, type Segment } from "../media/subtitles";

/**
 * "Reference style": the look of the owner's reference short in one step.
 * Cinematic Punch (small context words + one big glowing keyword, punch-in zoom with a flash, warm
 * moody grade, vignette) plus word cards placed from the real transcript, the way the reference
 * cuts away for a beat: a grid card with one quiet serif word, then a red accent card with a short
 * phrase around the keyword, alternating about every 9 seconds. Nothing is invented: every card
 * text is a word that is spoken at that moment, and the card starts when that word starts.
 */
export const REFERENCE_GAP = 9; // seconds between cards
const clean = (w: string) => w.replace(/[^\p{L}\p{N}'-]/gu, "");

export function referenceCards(segments: Segment[], clipLen: number, existing: WordCard[] = []): WordCard[] {
  const out: WordCard[] = [];
  let last = -Infinity;
  for (const c of existing) last = Math.max(last, c.at);
  let grid = existing.length % 2 === 0;
  for (const s of segments) {
    const words = s.words.filter((w) => clean(w.w).length > 0);
    if (words.length < 3) continue;
    if (s.start < 2.5 || s.start - last < REFERENCE_GAP || s.end > clipLen - 1) continue;
    if (existing.some((c) => Math.abs(c.at - s.start) < REFERENCE_GAP)) continue;
    if (grid) {
      // the first spoken word of the line, small and quiet, on grid paper
      const w = words[0];
      out.push({ ...newCard(w.s, clean(w.w).toLowerCase(), "grid"), dur: 0.8, anim: "cut", size: 140 });
    } else {
      // a three-word phrase around the keyword, keyword in capitals, on the red panel with a yellow bar
      const k = Math.min(Math.max(keywordIndex(words), 1), words.length - 2);
      const phrase = words.slice(k - 1, k + 2).map((w, i) => (i === 1 ? clean(w.w).toUpperCase() : clean(w.w).toLowerCase()));
      out.push({ ...newCard(words[k - 1].s, phrase.join(" "), "accent"), ...CARD_LOOKS.accent, upper: false, dur: 1.2, anim: "pop" });
    }
    last = s.start;
    grid = !grid;
  }
  return out;
}

/** Settings of the look (the subtitle style values match styleFor("punch") in the Studio). */
export const REFERENCE_CONFIG = {
  preset: "cinematic_punch" as const,
  aspect: "9:16" as const,
  burnSubtitles: true,
  style: { preset: "punch" as const, fontSize: 62, outline: 6, shadow: 3, marginV: 640 },
};
