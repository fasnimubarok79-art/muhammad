import { describe, expect, it } from "vitest";
import { buildSegments, parseCaptions, sliceWords, toAss, toSrt, toVtt, DEFAULT_STYLE, assColor, type Word } from "@/lib/media/subtitles";
import { parseSilences, proposeClips, toSentences } from "@/lib/media/clipping";
import { buildRenderArgs, keepIntervals, mapTime, outputSize, PRESETS, verifyOutput } from "@/lib/media/render";

const words: Word[] = "Why do most short videos fail? They waste the first three seconds. Start with the payoff instead. Then explain how you got there."
  .split(" ")
  .map((w, i) => ({ w, s: 1 + i * 0.4, e: 1 + i * 0.4 + 0.35 }));

describe("subtitles", () => {
  it("segments stay short and ordered, max two lines of text", () => {
    const segs = buildSegments(words);
    expect(segs.length).toBeGreaterThan(2);
    for (const s of segs) {
      expect(s.text.length).toBeLessThanOrEqual(36);
      expect(s.end).toBeGreaterThan(s.start);
    }
  });
  it("SRT and VTT round-trip", () => {
    const segs = buildSegments(words);
    const back = parseCaptions(toSrt(segs));
    expect(back.map((s) => s.text)).toEqual(segs.map((s) => s.text));
    expect(back[0].start).toBeCloseTo(segs[0].start, 2);
    expect(parseCaptions(toVtt(segs)).length).toBe(segs.length);
  });
  it("sliceWords keeps only words inside the window, clip-relative", () => {
    const w = sliceWords(words, 2, 4);
    expect(w[0].s).toBeGreaterThanOrEqual(0);
    expect(w.every((x) => x.e <= 2)).toBe(true);
  });
  it("ASS karaoke highlights each word exactly at its timestamp and escapes override braces", () => {
    const ass = toAss([{ start: 0, end: 1, text: "hi {\\pos(0,0)} there", words: [{ w: "hi", s: 0, e: 0.3 }, { w: "{\\pos(0,0)}", s: 0.3, e: 0.6 }, { w: "there", s: 0.6, e: 1 }] }], DEFAULT_STYLE);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events.length).toBe(3);
    expect(events[1]).toContain("0:00:00.30");
    expect(ass).not.toContain("{\\pos(0,0)}");
    expect(assColor("#FF7A1A")).toBe("&H001A7AFF");
  });
});

describe("clip proposal", () => {
  it("never proposes windows outside the source and starts on sentence boundaries", () => {
    const dur = 30;
    const clips = proposeClips(words, dur, [], { targets: [{ target: 6, min: 3, ideal: 6, max: 12 }] });
    expect(clips.length).toBeGreaterThan(0);
    const starts = new Set(toSentences(words).map((s) => s.start));
    for (const c of clips) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(dur);
      expect(Array.from(starts).some((s) => Math.abs(s - (c.start + 0.15)) < 0.2 || c.start === 0)).toBe(true);
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });
  it("returns nothing without speech (no invented clips)", () => {
    expect(proposeClips([], 60)).toEqual([]);
  });
  it("parses silencedetect output", () => {
    const s = parseSilences("[silencedetect @ 0x1] silence_start: 2.5\n[silencedetect @ 0x1] silence_end: 4 | silence_duration: 1.5\n[silencedetect @ 0x1] silence_start: 9", 10);
    expect(s).toEqual([{ start: 2.5, end: 4 }, { start: 9, end: 10 }]);
  });
});

describe("render plan", () => {
  it("output sizes", () => {
    expect(outputSize("9:16", "1080p")).toEqual({ w: 1080, h: 1920 });
    expect(outputSize("9:16", "720p")).toEqual({ w: 720, h: 1280 });
    expect(outputSize("16:9", "1080p")).toEqual({ w: 1920, h: 1080 });
    expect(outputSize("1:1", "450p")).toEqual({ w: 450, h: 450 });
  });
  it("silence removal keeps speech and remaps time", () => {
    const keep = keepIntervals(10, [{ start: 3, end: 5 }]);
    expect(keep.length).toBe(2);
    expect(mapTime(6, keep)).toBeCloseTo(6 - (keep[1].start - keep[0].end), 3);
  });
  it("never stretches: uses aspect-preserving scale for every framing", () => {
    for (const framing of ["blur", "crop", "pad"] as const) {
      const args = buildRenderArgs({ input: "/in.mp4", clipStart: 1, clipEnd: 11, srcFps: 30, hasAudio: true, aspect: "9:16", resolution: "1080p", framing, cropX: 0.5, preset: PRESETS.viral_short, keep: [{ start: 0, end: 10 }], output: "/out.mp4" });
      const fc = args[args.indexOf("-filter_complex") + 1];
      expect(fc).toMatch(/force_original_aspect_ratio=(increase|decrease)/);
      expect(args).toContain("libx264");
      expect(args).toContain("aac");
      expect(args.join(" ")).not.toContain("shell");
    }
  });
  it("verifyOutput flags wrong size and codec", () => {
    const bad = verifyOutput({ durationSec: 10, formatName: "mov,mp4", video: { codec: "hevc", width: 1080, height: 1080, fps: 30 }, audio: { codec: "aac" } }, { w: 1080, h: 1920, durationSec: 10 });
    expect(bad.ok).toBe(false);
    expect(bad.problems.length).toBe(2);
  });
});
