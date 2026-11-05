import { z } from "zod";
import { assColor, assText, assTime, wrapWords } from "./subtitles";

/**
 * Word cards: full-frame text inserts (paper, grid, black or accent background) that interrupt the shot
 * to stress one word or phrase. They are burned in through the same ASS file as the subtitles, so the
 * Studio preview and the FFmpeg render read one definition.
 */
export const CARD_STYLES = ["grid", "paper", "black", "accent"] as const;
export const CARD_ANIMS = ["fade", "pop", "cut"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];
export type CardAnim = (typeof CARD_ANIMS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const cardSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  at: z.number().min(0).max(36_000), // clip-relative seconds, like subtitle times
  dur: z.number().min(0.3).max(6), // hold on the output timeline
  text: z.string().trim().min(1).max(60),
  style: z.enum(CARD_STYLES),
  font: z.enum(["serif", "sans"]),
  italic: z.boolean(),
  upper: z.boolean(),
  size: z.number().int().min(60).max(320), // px at a 1920px-tall frame
  color: hex,
  bg: hex,
  accent: hex,
  y: z.number().min(0.15).max(0.85), // vertical centre as a share of the frame height
  anim: z.enum(CARD_ANIMS),
});
export const cardsSchema = z.array(cardSchema).max(40);
export type WordCard = z.infer<typeof cardSchema>;

/** Defaults per background; picking a background in the editor applies these. */
export const CARD_LOOKS: Record<CardStyle, Pick<WordCard, "bg" | "color" | "accent" | "font" | "italic" | "upper" | "size">> = {
  grid: { bg: "#F1F0EB", color: "#5C5C5C", accent: "#D9D7CF", font: "serif", italic: true, upper: false, size: 150 },
  paper: { bg: "#F1F0EB", color: "#4A4A4A", accent: "#D9D7CF", font: "serif", italic: true, upper: false, size: 150 },
  black: { bg: "#0B0B0C", color: "#FFFFFF", accent: "#FF7A1A", font: "serif", italic: true, upper: false, size: 150 },
  accent: { bg: "#C8102E", color: "#FFFFFF", accent: "#FFD21F", font: "sans", italic: false, upper: true, size: 130 },
};

export const CARD_FONTS = { serif: "Instrument Serif", sans: "Inter Black" } as const;
export const CARD_GRID_STEP = 64; // px at 1920 tall

export function newCard(at: number, text: string, style: CardStyle = "grid", id = Math.random().toString(36).slice(2, 10)): WordCard {
  return { id, at: Math.max(0, at), dur: 1.2, text: text.trim().slice(0, 60) || "word", style, y: 0.5, anim: "fade", ...CARD_LOOKS[style] };
}

/** Lines exactly as both the render and the preview break them (at most two). */
export function cardLines(card: Pick<WordCard, "text" | "size" | "upper">, playW: number): string[] {
  const text = card.upper ? card.text.toUpperCase() : card.text;
  const words = text.split(/\s+/).filter(Boolean);
  const maxChars = Math.max(6, Math.floor((playW * 0.84) / (card.size * 0.5)));
  return wrapWords(words, maxChars, 2).map((l) => l.join(" "));
}

/** Cards that overlap a time window (clip-relative), for the preview. */
export const activeCard = (cards: WordCard[] | undefined, t: number) => cards?.find((c) => t >= c.at && t < c.at + c.dur) ?? null;

const rect = (x: number, y: number, w: number, h: number) => `m ${x} ${y} l ${x + w} ${y} ${x + w} ${y + h} ${x} ${y + h}`;

/**
 * ASS events for cards already placed on the output timeline (`start` in output seconds).
 * Layers 10+ sit above every subtitle layer, so a card covers the caption while it is up.
 */
export function cardEvents(cards: Array<WordCard & { start: number }>, play = { w: 1080, h: 1920 }): string[] {
  const { w: W, h: H } = play;
  const out: string[] = [];
  for (const c of cards) {
    const s = assTime(c.start);
    const e = assTime(c.start + c.dur);
    const fad = c.anim === "fade" ? "\\fad(140,140)" : c.anim === "pop" ? "\\fad(0,90)" : "";
    const shape = (layer: number, colour: string, draw: string, extra = "") =>
      out.push(`Dialogue: ${layer},${s},${e},Card,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c${colour}${extra}${fad}}${draw}{\\p0}`);

    shape(10, assColor(c.bg), rect(0, 0, W, H));
    if (c.style === "grid") {
      const lines: string[] = [];
      for (let x = CARD_GRID_STEP; x < W; x += CARD_GRID_STEP) lines.push(rect(x, 0, 2, H));
      for (let y = CARD_GRID_STEP; y < H; y += CARD_GRID_STEP) lines.push(rect(0, y, W, 2));
      shape(11, assColor(c.accent), lines.join(" "));
    }
    if (c.style === "grid" || c.style === "paper") {
      // soft darker edges, like light falling off a sheet of paper
      const b = Math.round(W * 0.09);
      shape(12, "&H000000&", [rect(0, 0, W, b), rect(0, H - b, W, b), rect(0, 0, b, H), rect(W - b, 0, b, H)].join(" "), "\\1a&HF0&\\blur80");
    }
    if (c.style === "accent") shape(11, assColor(c.accent), rect(0, 0, Math.round(W * 0.05), H));

    const pop = c.anim === "pop" ? "\\fscx125\\fscy125\\t(0,160,\\fscx100\\fscy100)" : "";
    const text = cardLines(c, W).map(assText).join("\\N");
    out.push(
      `Dialogue: 13,${s},${e},Card,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${Math.round(H * c.y)})\\fn${CARD_FONTS[c.font]}\\fs${c.size}\\i${c.italic ? 1 : 0}\\b0\\c${assColor(c.color)}\\bord0\\shad0${fad}${pop}}${text}`,
    );
  }
  return out;
}

/** ASS style line the card events use. */
export const CARD_STYLE_LINE = "Style: Card,Inter Black,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1";

/**
 * Put clip-relative cards on the output timeline: shift by the trim, follow silence cuts, keep the hold
 * length, and drop cards that start outside the rendered window.
 */
export function placeCards(cards: WordCard[], tStart: number, winLen: number, outDur: number, mapTime: (t: number) => number | null) {
  return cards
    .map((c) => {
      const local = c.at - tStart;
      if (local < 0 || local >= winLen) return null;
      const start = mapTime(local);
      if (start === null || start >= outDur - 0.1) return null;
      return { ...c, start, dur: Math.min(c.dur, outDur - start) };
    })
    .filter((c): c is WordCard & { start: number } => c !== null)
    .sort((a, b) => a.start - b.start);
}
