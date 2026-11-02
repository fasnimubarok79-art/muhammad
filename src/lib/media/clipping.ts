import type { Word } from "./subtitles";

export type Interval = { start: number; end: number };
export type Sentence = { start: number; end: number; text: string; words: Word[] };
export type ScoreReason = { factor: string; score: number; note: string };
export type ClipCandidate = {
  start: number;
  end: number;
  title: string;
  description: string;
  hookText: string;
  score: number; // viral potential 0..100, an estimate
  hookScore: number;
  engagementScore: number;
  targetDuration: number;
  reasons: ScoreReason[];
  insights: { why: string; moments: MomentType[]; momentsBasis: string; platforms: Array<{ platform: string; aspect: string }> };
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

// ---------- v2 scoring: hook, engagement, viral potential (all explainable estimates) ----------

const DIRECT = /\b(you|your|kamu|anda|kalian|lo|lu|elo|gue|kita)\b/i;
const CURIOSITY = /\b(why|how|secret|never|stop|mistake|truth|nobody|imagine|kenapa|mengapa|bagaimana|gimana|cara|rahasia|ternyata|jangan|kesalahan|fakta|bayangkan|nggak ada yang|tidak ada yang)\b/i;
const FILLER_START = /^(um+|uh+|eh+|hmm+|so|and|but|well|jadi|terus|nah|dan|tapi|ya|oke|okay)\b[,\s]/i;
const EMPHASIS = /\b(very|really|never|always|biggest|best|worst|amazing|incredible|banget|sangat|paling|selalu|luar biasa|gila|parah|serius)\b/i;

/** Keyword-based moment labels. They describe words that appear, not an understanding of humour or emotion. */
const MOMENTS: Array<{ id: MomentType; re: RegExp }> = [
  { id: "educational", re: /\b(how to|step|tips?|learn|because|reason|example|means|cara|langkah|belajar|karena|contoh|artinya|caranya|alasannya|jadi intinya)\b/i },
  { id: "funny", re: /\b(haha+|hehe+|wkwk+|lol|lmao|funny|joke|lucu|ngakak|becanda|bercanda)\b|\((laughs?|laughter|tertawa)\)/i },
  { id: "emotional", re: /\b(love|cry|cried|afraid|fear|proud|sad|hurt|miss|cinta|sayang|nangis|menangis|takut|bangga|sedih|sakit hati|kangen|terharu)\b/i },
  { id: "inspirational", re: /\b(dream|success|never give up|believe|fight|future|country|mimpi|sukses|jangan menyerah|percaya|berjuang|masa depan|negara|semangat)\b/i },
  { id: "controversial", re: /\b(wrong|lie|scam|unpopular|controversial|salah|bohong|penipuan|kontroversi|nggak setuju|tidak setuju)\b/i },
];
export type MomentType = "educational" | "funny" | "emotional" | "inspirational" | "controversial";

export const LENGTH_TARGETS = [
  { target: 15, min: 10, ideal: 15, max: 21 },
  { target: 30, min: 21, ideal: 30, max: 38 },
  { target: 45, min: 38, ideal: 45, max: 53 },
  { target: 60, min: 53, ideal: 60, max: 70 },
] as const;

type Target = { target: number; min: number; ideal: number; max: number };

function hookOf(first: string, firstWordAt: number, windowStart: number) {
  const words = first.split(/\s+/).filter(Boolean);
  const signals: Array<[boolean, number, string]> = [
    [/\?/.test(first), 0.22, "asks a question"],
    [CURIOSITY.test(first), 0.2, "curiosity word"],
    [DIRECT.test(first), 0.16, "talks to the viewer"],
    [/\d/.test(first), 0.12, "contains a number"],
    [words.length > 0 && words.length <= 12, 0.14, "short opening line"],
    [!FILLER_START.test(first), 0.1, "no filler at the start"],
    [firstWordAt - windowStart < 0.8, 0.06, "speech starts immediately"],
  ];
  const score = signals.reduce((a, [hit, w]) => a + (hit ? w : 0), 0);
  return { score: clamp01(score), hits: signals.filter(([h]) => h).map(([, , n]) => n) };
}

function scoreWindow(sents: Sentence[], silences: Interval[], keywords: Set<string>, t: Target) {
  const start = sents[0].start;
  const end = sents[sents.length - 1].end;
  const dur = end - start;
  const words = sents.flatMap((s) => s.words);
  const text = sents.map((s) => s.text).join(" ");
  const reasons: ScoreReason[] = [];

  const hook = hookOf(sents[0].text, sents[0].words[0]?.s ?? start, start);
  reasons.push({ factor: "hook", score: hook.score, note: hook.hits.length ? `Opening line: ${hook.hits.join(", ")}` : "Opening line has no strong hook signals" });

  const wps = words.length / Math.max(dur, 0.1);
  const density = clamp01(1 - Math.abs(wps - 2.6) / 2.6);
  reasons.push({ factor: "speech_density", score: density, note: `${wps.toFixed(1)} words/sec (natural speech is about 2 to 3.5)` });

  const silent = silences.reduce((acc, s) => acc + overlap(s, { start, end }), 0);
  const quiet = clamp01(1 - silent / Math.max(dur, 0.1) / 0.4);
  reasons.push({ factor: "low_dead_air", score: quiet, note: `${Math.round((silent / Math.max(dur, 0.1)) * 100)}% detected silence` });

  const complete = /[.!?…]["')\]]?$/.test(sents[sents.length - 1].text.trim()) ? 1 : 0.5;
  reasons.push({ factor: "complete_thought", score: complete, note: complete === 1 ? "Ends on a finished sentence" : "Ends at a pause, not punctuation" });

  const toks = tokens(text);
  const topical = toks.length ? clamp01((toks.filter((k) => keywords.has(k)).length / toks.length) * 4) : 0;
  reasons.push({ factor: "topic_relevance", score: topical, note: "Share of words that are recurring topics of the whole video" });

  const emph = clamp01((text.match(new RegExp(EMPHASIS.source, "gi"))?.length ?? 0) / Math.max(1, sents.length) + (/[!]/.test(text) ? 0.3 : 0));
  reasons.push({ factor: "emphasis", score: emph, note: "Emphatic words or exclamations" });

  const lengthFit = dur < t.min ? dur / t.min : dur > t.max ? 0 : clamp01(1 - Math.abs(dur - t.ideal) / t.ideal);
  reasons.push({ factor: "length_fit", score: lengthFit, note: `${dur.toFixed(1)}s for a ${t.target}s clip` });

  const r = (f: string) => reasons.find((x) => x.factor === f)!.score;
  const hookScore = Math.round(hook.score * 100);
  const engagementScore = Math.round((r("speech_density") * 0.25 + r("low_dead_air") * 0.25 + r("complete_thought") * 0.2 + r("topic_relevance") * 0.2 + r("emphasis") * 0.1) * 100);
  const score = Math.round(hookScore * 0.4 + engagementScore * 0.45 + r("length_fit") * 100 * 0.15);
  return { start, end, text, firstSentence: sents[0].text, score, hookScore, engagementScore, reasons, target: t.target };
}

function platformsFor(dur: number) {
  const out = [
    { platform: "TikTok", aspect: "9:16" },
    { platform: "Instagram Reels", aspect: "9:16" },
    { platform: "YouTube Shorts", aspect: "9:16" },
  ];
  if (dur <= 60) out.push({ platform: "Instagram Feed", aspect: "1:1" });
  return out;
}

/** 5 to 20 clips depending on how long the speech is (about two per minute). */
export function clipBudget(speechSeconds: number) {
  return Math.max(5, Math.min(20, Math.round((speechSeconds / 60) * 2)));
}

/**
 * Propose clip windows that start and end on sentence boundaries, never outside the source
 * duration, for 15/30/45/60 second targets, scored by explainable signals from the real
 * transcript and audio analysis. Returns fewer clips when the video is too short for more.
 */
export function proposeClips(
  words: Word[],
  durationSec: number,
  silences: Interval[] = [],
  opts: { limit?: number; targets?: readonly Target[] } = {},
): ClipCandidate[] {
  const sents = toSentences(words).filter((s) => s.end > s.start);
  if (!sents.length || !(durationSec > 0)) return [];
  const speechSpan = sents[sents.length - 1].end - sents[0].start;
  let targets: Target[] = (opts.targets ?? LENGTH_TARGETS).filter((t) => t.min <= speechSpan + 0.5);
  if (!targets.length) {
    // very short source: one target that fits the speech
    const ideal = Math.max(3, speechSpan);
    targets = [{ target: Math.round(ideal), min: Math.max(2, speechSpan * 0.6), ideal, max: speechSpan + 1 }];
  }
  const keywords = new Set(topKeywords(sents.map((s) => s.text).join(" "), 15));

  const windows: ReturnType<typeof scoreWindow>[] = [];
  for (const t of targets) {
    for (let i = 0; i < sents.length; i++) {
      for (let j = i; j < sents.length; j++) {
        const dur = sents[j].end - sents[i].start;
        if (dur > t.max) break;
        if (dur < t.min) continue;
        windows.push(scoreWindow(sents.slice(i, j + 1), silences, keywords, t));
      }
    }
  }
  windows.sort((a, b) => b.score - a.score || a.start - b.start);

  const limit = opts.limit ?? clipBudget(speechSpan);
  const chosen: typeof windows = [];
  for (const w of windows) {
    if (chosen.length >= limit) break;
    const clash = chosen.some((c) => {
      const ov = overlap(c, w);
      const iou = ov / (Math.max(c.end, w.end) - Math.min(c.start, w.start));
      // same length bucket: no real overlap; different buckets: allow longer/shorter cuts of one moment, not near-copies
      return c.target === w.target ? ov > 0.3 * Math.min(c.end - c.start, w.end - w.start) : iou > 0.75;
    });
    if (!clash) chosen.push(w);
  }

  return chosen
    .sort((a, b) => a.start - b.start)
    .map((w) => {
      const start = Math.max(0, w.start - 0.15);
      const end = Math.min(durationSec, w.end + 0.3);
      const moments = MOMENTS.filter((m) => m.re.test(w.text)).map((m) => m.id);
      const top = [...w.reasons].filter((r) => r.factor !== "length_fit").sort((a, b) => b.score - a.score).slice(0, 2);
      return {
        start,
        end,
        title: w.firstSentence.length > 70 ? w.firstSentence.slice(0, 67).trimEnd() + "..." : w.firstSentence,
        description: w.text.length > 220 ? w.text.slice(0, 217).trimEnd() + "..." : w.text,
        hookText: w.firstSentence.slice(0, 160),
        score: w.score,
        hookScore: w.hookScore,
        engagementScore: w.engagementScore,
        targetDuration: w.target,
        reasons: w.reasons,
        insights: {
          why: top.map((r) => r.note).join("; "),
          moments,
          momentsBasis: "keyword match in the transcript",
          platforms: platformsFor(end - start),
        },
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
