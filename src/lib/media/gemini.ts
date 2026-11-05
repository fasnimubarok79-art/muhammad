"use server";

import { env } from "@/lib/env";

/**
 * Gemini LLM client for ClipKita-Pro.
 *
 * Uses the Google Gemini API to generate viral hooks, short titles and
 * identify high-impact words for semantic highlighting. Only works when
 * GEMINI_API_KEY is configured; otherwise every method throws a clear error
 * so the UI can degrade gracefully instead of faking AI results.
 */
const GEMINI_MODEL = "gemini-1.5-flash-latest";

export type GeminiHighlightWord = {
  word: string;
  color: "yellow" | "green";
  reason: string;
};

export type GeminiTitle = {
  title: string;
  hook: string;
  confidence: number;
};

export class GeminiUnavailable extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured. Set it in .env to enable AI hooks, titles and semantic highlighting.");
  }
}

function requireKey(): string {
  const key = env().GEMINI_API_KEY;
  if (!key) throw new GeminiUnavailable();
  return key;
}

async function geminiPrompt(prompt: string): Promise<string> {
  const key = requireKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 400,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text.trim();
}

/** Generate a short, viral-style title from a transcript snippet. */
export async function generateTitle(transcript: string): Promise<GeminiTitle> {
  const prompt = [
    "You are a short-form video editor (YouTube Shorts / TikTok / Reels).",
    "Given this transcript snippet, write ONE short, punchy title (max 60 characters) and ONE hook sentence (max 120 characters).",
    "The title should make viewers stop scrolling. The hook should explain why they should watch.",
    'Respond ONLY as JSON: {"title": "...", "hook": "...", "confidence": 0.0-1.0}.',
    "",
    `Transcript: "${transcript.slice(0, 3000)}"`,
  ].join("\n");

  const text = await geminiPrompt(prompt);
  // Gemini sometimes wraps JSON in markdown fences; strip them.
  const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(clean);
  return {
    title: String(parsed.title ?? "").slice(0, 60),
    hook: String(parsed.hook ?? "").slice(0, 120),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
  };
}

/** Identify high-impact words in a transcript for semantic highlighting. */
export async function highlightWords(words: string[]): Promise<GeminiHighlightWord[]> {
  if (words.length === 0) return [];
  const prompt = [
    "You are a subtitle stylist for high-energy short-form videos (Hormozi / Pro Shorts style).",
    "Given this list of spoken words, identify high-impact words worth highlighting:",
    "- numbers, currencies, dollar amounts, percentages",
    "- strong verbs and emotional keywords",
    "- key nouns that carry the main point",
    "Assign each highlighted word a color: yellow for primary emphasis, green for secondary.",
    'Respond ONLY as JSON array: [{"word":"...","color":"yellow","reason":"..."}].',
    "Only include words actually present in the list (exact match, case-insensitive).",
    "",
    `Words: ${words.join(", ")}`,
  ].join("\n");

  const text = await geminiPrompt(prompt);
  const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(clean);
  const wordSet = new Set(words.map((w) => w.toLowerCase()));
  const result: GeminiHighlightWord[] = [];
  for (const item of parsed) {
    const w = String(item.word ?? "");
    if (wordSet.has(w.toLowerCase())) {
      result.push({
        word: w,
        color: item.color === "green" ? "green" : "yellow",
        reason: String(item.reason ?? ""),
      });
    }
  }
  return result;
}
