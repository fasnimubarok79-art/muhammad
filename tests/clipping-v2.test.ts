import { describe, expect, it } from "vitest";
import { clipBudget, LENGTH_TARGETS, proposeClips } from "@/lib/media/clipping";
import type { Word } from "@/lib/media/subtitles";

// ~5 minutes of synthetic speech: varied sentences, 2.5 words/sec, short pauses between sentences.
const SENTENCES = [
  "Kenapa kebanyakan video pendek gagal di tiga detik pertama?",
  "Karena pembukaannya lambat dan penonton langsung pergi.",
  "Caranya sederhana, mulai dari hasil akhirnya dulu.",
  "Lalu jelaskan langkah yang membuat hasil itu terjadi.",
  "This is the biggest mistake I see every single week!",
  "You do not need expensive gear to make a good clip.",
  "Saya dulu takut kamera, tapi sekarang saya bangga dengan karya saya.",
  "Haha, waktu pertama kali rekam saya lupa menyalakan mikrofon.",
  "Tips berikutnya adalah memotong jeda yang terlalu panjang.",
  "Penonton menghargai waktu mereka, jadi jangan buang waktu.",
];
function transcript(seconds: number): Word[] {
  const words: Word[] = [];
  let t = 1;
  let i = 0;
  while (t < seconds - 5) {
    for (const w of SENTENCES[i % SENTENCES.length].split(" ")) {
      words.push({ w, s: t, e: t + 0.32 });
      t += 0.4;
    }
    t += 0.5;
    i++;
  }
  return words;
}

describe("clip detection v2", () => {
  it("budget is 5..20 and grows with speech length", () => {
    expect(clipBudget(30)).toBe(5);
    expect(clipBudget(5 * 60)).toBe(10);
    expect(clipBudget(60 * 60)).toBe(20);
  });

  it("long source: several clips across 15/30/45/60 targets, all inside the source", () => {
    const dur = 300;
    const clips = proposeClips(transcript(dur), dur);
    expect(clips.length).toBeGreaterThanOrEqual(5);
    expect(clips.length).toBeLessThanOrEqual(20);
    const targets = new Set(clips.map((c) => c.targetDuration));
    expect(targets.size).toBeGreaterThanOrEqual(3);
    for (const c of clips) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(dur);
      const t = LENGTH_TARGETS.find((x) => x.target === c.targetDuration)!;
      expect(c.end - c.start).toBeLessThanOrEqual(t.max + 0.5);
      for (const s of [c.score, c.hookScore, c.engagementScore]) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
      expect(c.hookText.length).toBeGreaterThan(3);
      expect(c.insights.platforms.length).toBeGreaterThan(0);
      expect(c.insights.why.length).toBeGreaterThan(0);
    }
  });

  it("question/curiosity openers score a stronger hook than filler openers", () => {
    const mk = (text: string): Word[] => text.split(" ").map((w, i) => ({ w, s: 1 + i * 0.4, e: 1.32 + i * 0.4 }));
    const opts = { targets: [{ target: 5, min: 2, ideal: 5, max: 12 }] };
    const strong = proposeClips(mk("Kenapa kamu selalu gagal di tiga detik pertama? Ini jawabannya."), 30, [], opts)[0];
    const weak = proposeClips(mk("Jadi ya terus kita lanjut saja ke bagian berikutnya ini."), 30, [], opts)[0];
    expect(strong.hookScore).toBeGreaterThan(weak.hookScore);
  });

  it("labels moments by keywords and says so", () => {
    const dur = 300;
    const clips = proposeClips(transcript(dur), dur);
    const all = new Set(clips.flatMap((c) => c.insights.moments));
    expect(all.has("educational")).toBe(true);
    expect(clips[0].insights.momentsBasis).toMatch(/keyword/);
  });
});
