/** Word timing as produced by Whisper (seconds). */
export type Word = { w: string; s: number; e: number; p?: number };
export type Segment = { start: number; end: number; text: string; words: Word[] };

export type SegmentOptions = { maxCharsPerLine: number; maxLines: number; maxDuration: number; pauseSplit: number };
export const VERTICAL_SEGMENTS: SegmentOptions = { maxCharsPerLine: 18, maxLines: 2, maxDuration: 3.2, pauseSplit: 0.6 };

const clean = (w: string) => w.replace(/\s+/g, " ").trim();

/** Group words into short subtitle segments: split on pauses, length and punctuation. */
export function buildSegments(words: Word[], opt: SegmentOptions = VERTICAL_SEGMENTS): Segment[] {
  const out: Segment[] = [];
  let cur: Word[] = [];
  const maxChars = opt.maxCharsPerLine * opt.maxLines;
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" "), words: cur });
    cur = [];
  };
  for (const raw of words) {
    const w = { ...raw, w: clean(raw.w) };
    if (!w.w || !(w.e >= w.s)) continue;
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const text = cur.map((x) => x.w).join(" ") + " " + w.w;
      if (w.s - prev.e > opt.pauseSplit || text.length > maxChars || w.e - cur[0].s > opt.maxDuration) flush();
    }
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  return out;
}

/** Break a segment's words into at most `maxLines` balanced lines. */
export function wrapWords(words: string[], maxChars: number, maxLines: number): string[][] {
  const total = words.join(" ").length;
  if (total <= maxChars || maxLines < 2) return [words];
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const diff = Math.max(a, b) + Math.abs(a - b) * 0.25;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best), words.slice(best)];
}

/** Shift words into a clip window and drop words that fall outside it. */
export function sliceWords(words: Word[], start: number, end: number): Word[] {
  return words
    .filter((w) => w.e > start + 0.01 && w.s < end - 0.01)
    .map((w) => ({ ...w, s: Math.max(0, w.s - start), e: Math.min(end - start, w.e - start) }));
}

// ---------- SRT / VTT ----------

function ts(sec: number, sep: "," | ".") {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

export function toSrt(segs: Pick<Segment, "start" | "end" | "text">[]) {
  return segs.map((s, i) => `${i + 1}\n${ts(s.start, ",")} --> ${ts(s.end, ",")}\n${s.text}\n`).join("\n");
}

export function toVtt(segs: Pick<Segment, "start" | "end" | "text">[]) {
  return "WEBVTT\n\n" + segs.map((s) => `${ts(s.start, ".")} --> ${ts(s.end, ".")}\n${s.text}\n`).join("\n");
}

function parseTs(t: string): number {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) throw new Error(`Bad timestamp: ${t}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/**
 * Parse SRT or VTT. Files carry no word timing, so word times are spread evenly across each cue
 * (`p: -1` marks them as approximate).
 */
export function parseCaptions(text: string): Segment[] {
  const blocks = text.replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  const segs: Segment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const idx = lines.findIndex((l) => l.includes("-->"));
    if (idx < 0) continue;
    const [a, b] = lines[idx].split("-->");
    const start = parseTs(a);
    const end = parseTs(b.trim().split(/\s+/)[0]);
    const body = lines.slice(idx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!body || !(end > start)) continue;
    const parts = body.split(/\s+/);
    const step = (end - start) / parts.length;
    segs.push({ start, end, text: body, words: parts.map((w, i) => ({ w, s: start + i * step, e: start + (i + 1) * step, p: -1 })) });
  }
  if (segs.length > 5000) throw new Error("Too many cues");
  return segs;
}

// ---------- ASS (burned-in) ----------

export type SubtitleStyle = {
  preset: "karaoke" | "clean" | "pop" | "impact" | "punch";
  fontName: string;
  fontSize: number; // at PlayResY
  primary: string; // #RRGGBB
  highlight: string;
  outline: number;
  shadow: number;
  marginV: number; // distance from bottom at PlayResY
  maxCharsPerLine: number;
};

/** "Impact": huge centred captions, yellow active word, heavy stroke, sharp shadow (short-form style). */
export const IMPACT_STYLE: Partial<SubtitleStyle> = { preset: "impact", fontSize: 108, highlight: "#FFD21F", outline: 10, shadow: 5, marginV: 840, maxCharsPerLine: 14 };

/**
 * "Punch": small white context words above ONE big, upper-case, italic keyword in a rotating accent
 * colour with a soft glow; the keyword pops in when it is spoken (short-form podcast style).
 */
export const PUNCH_STYLE: Partial<SubtitleStyle> = { preset: "punch", fontSize: 62, outline: 6, shadow: 3, marginV: 640, maxCharsPerLine: 22 };
export const PUNCH_COLORS = ["#3FA9FF", "#FF3B3B", "#3DDC72", "#FFD21F"];
export const PUNCH_KEYWORD_SCALE = 1.9;

const KEY_STOP = new Set(
  (
    "yang dan di ke dari ini itu dengan untuk pada adalah atau juga tidak akan sudah saya kamu kita kami mereka dia ada bisa jadi karena tapi kalau lagi aja nya sih kan dong ya gua gue lo lu aku " +
    "kok deh lah pun para oleh sama udah belum masih harus mau buat bikin kayak gitu gini sebuah satu banyak lebih sangat " +
    "the and a an of to in on is are was were it this that you we they i for can do does did not no so as at be by with your my our their his her what who how when where why just also very really"
  ).split(" "),
);

/** Index of the word to emphasise: the longest non-filler word (ties: the later one). */
export function keywordIndex(words: Array<{ w: string }>): number {
  let best = -1;
  let len = 0;
  words.forEach((w, i) => {
    const clean = w.w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (clean.length >= 3 && !KEY_STOP.has(clean) && clean.length >= len) {
      best = i;
      len = clean.length;
    }
  });
  return best >= 0 ? best : Math.max(0, words.length - 1);
}

export const DEFAULT_STYLE: SubtitleStyle = {
  preset: "karaoke",
  fontName: "Inter Black",
  fontSize: 84,
  primary: "#FFFFFF",
  highlight: "#FF7A1A",
  outline: 7,
  shadow: 3,
  marginV: 540,
  maxCharsPerLine: 18,
};

/** #RRGGBB -> ASS &H00BBGGRR */
export function assColor(hex: string, alpha = 0) {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) throw new Error("Bad colour");
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

export const assText = (s: string) => s.replace(/\\/g, "＼").replace(/[{}]/g, (c) => (c === "{" ? "｛" : "｝"));

export function assTime(sec: number) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/**
 * Build an ASS script. Karaoke/pop presets emit one event per word so the highlighted word
 * switches exactly at the word timestamps from the transcript.
 */
/** `extra` adds styles and events from other burned-in layers (word cards) to the same script. */
export function toAss(segs: Segment[], style: SubtitleStyle, play = { w: 1080, h: 1920 }, extra: { styles: string[]; events: string[] } = { styles: [], events: [] }) {
  let punchIdx = 0;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${play.w}`,
    `PlayResY: ${play.h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Main,${style.fontName},${style.fontSize},${assColor(style.primary)},${assColor(style.highlight)},&H00000000,&H96000000,${/black|extrabold|heavy/i.test(style.fontName) ? 0 : -1},0,0,0,100,100,0,0,1,${style.outline},${style.shadow},2,80,80,${style.marginV},1`,
    ...extra.styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const hl = assColor(style.highlight);
  const events: string[] = [];
  for (const seg of segs) {
    const words = seg.words.length ? seg.words : [{ w: seg.text, s: seg.start, e: seg.end }];
    const lines = wrapWords(words.map((w) => w.w), style.maxCharsPerLine, 2);
    const lineOf: number[] = [];
    lines.forEach((l, li) => l.forEach(() => lineOf.push(li)));
    const render = (active: number) =>
      words
        .map((w, i) => {
          const sep = i === 0 ? "" : lineOf[i] !== lineOf[i - 1] ? "\\N" : " ";
          const t = assText(w.w);
          if (i !== active || style.preset === "clean") return sep + t;
          const pop = style.preset === "pop" || style.preset === "impact" ? "\\fscx118\\fscy118\\t(0,90,\\fscx100\\fscy100)" : "";
          return `${sep}{\\c${hl}${pop}\\blur0.6}${t}{\\r}`;
        })
        .join("");
    if (style.preset === "punch") {
      // two events: context words alone until the keyword is spoken, then context + big keyword popping in
      const k = keywordIndex(words);
      const ctx = words.filter((_, i) => i !== k).map((w) => assText(w.w)).join(" ");
      const kwText = assText(words[k].w.replace(/[.,!?;:…]+$/, "").toUpperCase());
      const color = PUNCH_COLORS[punchIdx++ % PUNCH_COLORS.length];
      const big = Math.round(style.fontSize * PUNCH_KEYWORD_SCALE);
      const kwStart = Math.max(seg.start, Math.min(words[k].s, seg.end - 0.05));
      const glow = `{\\fs${big}\\i1\\bord${Math.round(style.outline * 2.2)}\\3c${assColor(color)}\\3a&H30&\\blur10\\1a&HFF&\\shad0}${kwText}`;
      const kw = `{\\fs${big}\\i1\\c${assColor(color)}\\3c&H000000&\\fscx135\\fscy135\\t(0,110,\\fscx100\\fscy100)}${kwText}`;
      if (kwStart - seg.start > 0.05 && ctx) events.push(`Dialogue: 1,${assTime(seg.start)},${assTime(kwStart)},Main,,0,0,0,,${ctx}`);
      events.push(`Dialogue: 0,${assTime(kwStart)},${assTime(seg.end)},Main,,0,0,0,,${ctx ? "{\\alpha&HFF&}" + ctx + "\\N" : ""}${glow}`);
      events.push(`Dialogue: 1,${assTime(kwStart)},${assTime(seg.end)},Main,,0,0,0,,${ctx ? ctx + "\\N" : ""}${kw}`);
      continue;
    }
    if (style.preset === "clean") {
      events.push(`Dialogue: 0,${assTime(seg.start)},${assTime(seg.end)},Main,,0,0,0,,${render(-1)}`);
      continue;
    }
    words.forEach((w, i) => {
      const start = i === 0 ? seg.start : w.s;
      const end = i === words.length - 1 ? seg.end : words[i + 1].s;
      if (end - start < 0.01) return;
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Main,,0,0,0,,${render(i)}`);
    });
  }
  events.push(...extra.events);
  return header.join("\n") + "\n" + events.join("\n") + "\n";
}
