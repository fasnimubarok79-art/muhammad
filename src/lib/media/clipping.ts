import type { Word } from "./subtitles";

export type Interval = { start: number; end: number };
export type Sentence = { start: number; end: number; text: string; words: Word[] };
export type ScoreReason = { factor: string; score: number; note: string };
export type ClipCandidate = {
  start: number;
  end: number;
  title: string;
  description: string;
  score: number; // 0..100, an estimate
  reasons: ScoreReason[];
  transcriptRef: string;
};

const STOP = new Set(
  (
    "a an the and or but if then so to of in on at for with from by as is are was were be been being it its this that these those i you he she we they me him her us them my your our their " +
    "not no do does did have has had will would can could should just very really there here what which who whom when where why how all any some more most such than too also into out up down over about " +
    "yang dan di ke dari ini itu dengan untuk pada adalah atau juga tidak akan sudah saya kamu kita kami mereka dia ada bisa jadi karena tapi kalau lagi aja nya sih kan dong ya"
  ).split(" "),
);

export function tokens(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Split word stream into sentences on terminal punctuation or long pauses. */
export function toSentences(words: Word[], pause = 0.8): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: cur.map((w) => w.w.trim()).join(" "), words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    if (cur.length && w.s - cur[cur.length - 1].e > pause) flush();
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?…]["')\]]?$/.test(w.w.trim()) || !next) flush();
  });
  return out;
}

function overlap(a: Interval, b: Interval) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function topKeywords(text: string, n = 8) {
  const freq = new Map<string, number>();
  tokens(text).forEach((t) => freq.set(t, (freq.get(t) ?? 0) + 1));
  return Array.from(freq.entries())
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

function scoreWindow(sents: Sentence[], silences: Interval[], keywords: Set<string>, target: { min: number; ideal: number; max: number }) {
  const start = sents[0].start;
  const end = sents[sents.length - 1].end;
  const dur = end - start;
  const words = sents.flatMap((s) => s.words);
  const text = sents.map((s) => s.text).join(" ");
  const reasons: ScoreReason[] = [];

  const first = sents[0].text;
  const hookSignals = [/\?/.test(first), /\d/.test(first), first.split(/\s+/).length <= 12, /\b(you|kamu|anda|why|how|kenapa|bagaimana|rahasia|secret)\b/i.test(first)];
  const hook = hookSignals.filter(Boolean).length / hookSignals.length;
  reasons.push({ factor: "hook", score: hook, note: "Opening sentence: question, number, direct address or short and punchy" });

  const wps = words.length / Math.max(dur, 0.1);
  const density = clamp01(1 - Math.abs(wps - 2.6) / 2.6);
  reasons.push({ factor: "speech_density", score: density, note: `${wps.toFixed(1)} words/sec (natural speech is about 2 to 3.5)` });

  const silent = silences.reduce((acc, s) => acc + overlap(s, { start, end }), 0);
  const quiet = clamp01(1 - silent / Math.max(dur, 0.1) / 0.4);
  reasons.push({ factor: "low_dead_air", score: quiet, note: `${Math.round((silent / Math.max(dur, 0.1)) * 100)}% detected silence` });

  const complete = /[.!?…]["')\]]?$/.test(sents[sents.length - 1].text.trim()) ? 1 : 0.5;
  reasons.push({ factor: "complete_thought", score: complete, note: complete === 1 ? "Ends on a finished sentence" : "Ends at a pause, not punctuation" });

  const lengthFit = dur < target.min ? dur / target.min : dur > target.max ? 0 : clamp01(1 - Math.abs(dur - target.ideal) / target.ideal);
  reasons.push({ factor: "length_fit", score: lengthFit, note: `${dur.toFixed(1)}s against an ideal of ${target.ideal}s` });

  const toks = tokens(text);
  const topical = toks.length ? clamp01((toks.filter((t) => keywords.has(t)).length / toks.length) * 4) : 0;
  reasons.push({ factor: "topic_relevance", score: topical, note: "Share of words that are recurring topics of the whole video" });

  const weights: Record<string, number> = { hook: 0.25, speech_density: 0.15, low_dead_air: 0.15, complete_thought: 0.15, length_fit: 0.15, topic_relevance: 0.15 };
  const score = Math.round(reasons.reduce((acc, r) => acc + r.score * weights[r.factor], 0) * 100);
  return { start, end, text, score, reasons };
}

/**
 * Propose clip windows that start and end on sentence boundaries, never outside the source
 * duration, scored by explainable signals from the real transcript and audio analysis.
 */
export function proposeClips(
  words: Word[],
  durationSec: number,
  silences: Interval[] = [],
  opts: { min?: number; ideal?: number; max?: number; limit?: number } = {},
): ClipCandidate[] {
  const sents = toSentences(words).filter((s) => s.end > s.start);
  if (!sents.length || !(durationSec > 0)) return [];
  const speechSpan = sents[sents.length - 1].end - sents[0].start;
  const target = {
    min: Math.min(opts.min ?? 15, Math.max(3, speechSpan * 0.6)),
    ideal: Math.min(opts.ideal ?? 35, Math.max(5, speechSpan)),
    max: Math.max(opts.max ?? 60, Math.min(speechSpan + 1, 60)),
  };
  const keywords = new Set(topKeywords(sents.map((s) => s.text).join(" "), 15));

  const windows: ReturnType<typeof scoreWindow>[] = [];
  for (let i = 0; i < sents.length; i++) {
    for (let j = i; j < sents.length; j++) {
      const dur = sents[j].end - sents[i].start;
      if (dur > target.max) break;
      if (dur < target.min) continue;
      windows.push(scoreWindow(sents.slice(i, j + 1), silences, keywords, target));
    }
  }
  windows.sort((a, b) => b.score - a.score || a.start - b.start);

  const chosen: typeof windows = [];
  for (const w of windows) {
    if (chosen.length >= (opts.limit ?? 10)) break;
    if (chosen.some((c) => overlap(c, w) > 0.3 * Math.min(c.end - c.start, w.end - w.start))) continue;
    chosen.push(w);
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .map((w) => {
      const start = Math.max(0, w.start - 0.15);
      const end = Math.min(durationSec, w.end + 0.3);
      const firstSentence = w.text.split(/(?<=[.!?…])\s/)[0];
      return {
        start,
        end,
        title: firstSentence.length > 70 ? firstSentence.slice(0, 67).trimEnd() + "..." : firstSentence,
        description: w.text.length > 220 ? w.text.slice(0, 217).trimEnd() + "..." : w.text,
        score: w.score,
        reasons: w.reasons,
        transcriptRef: `${start.toFixed(2)}-${end.toFixed(2)}`,
      };
    });
}

/** Parse `silencedetect` stderr into intervals. */
export function parseSilences(stderr: string, durationSec: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) open = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) {
      out.push({ start: open, end: Number(e[1]) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: durationSec });
  return out;
}

/** Parse `scdet` / showinfo-style scene scores from stderr into timestamps. */
export function parseScenes(stderr: string): number[] {
  const out: number[] = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(/lavfi\.scd\.time:\s*([\d.]+)/);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/** Hashtag suggestions from recurring words in the clip's own transcript. */
export function hashtagsFrom(text: string, n = 5) {
  const kws = topKeywords(text, n);
  const fallback = tokens(text).slice(0, n);
  return Array.from(new Set(kws.length ? kws : fallback)).map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, "")}`).filter((h) => h.length > 2);
}
