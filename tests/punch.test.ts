import { describe, expect, it } from "vitest";
import { keywordIndex, toAss, DEFAULT_STYLE, PUNCH_STYLE, PUNCH_COLORS, assColor, type SubtitleStyle } from "@/lib/media/subtitles";
import { buildRenderArgs, punchPlan, PRESETS } from "@/lib/media/render";

const mk = (text: string, start: number, step = 0.4) =>
  text.split(" ").map((w, i) => ({ w, s: start + i * step, e: start + i * step + step * 0.9 }));
const style = { ...DEFAULT_STYLE, ...PUNCH_STYLE } as SubtitleStyle;

describe("cinematic punch subtitles", () => {
  it("keywordIndex picks the longest content word, not a stopword", () => {
    expect(keywordIndex(mk("and so my fellow Americans,", 0))).toBe(4);
    expect(keywordIndex(mk("ini adalah rahasia sukses", 0))).toBe(2);
    expect(keywordIndex(mk("it is for you", 0))).toBeGreaterThanOrEqual(0);
  });

  it("context appears at segment start and the keyword pops in at its own word time", () => {
    const words = mk("And so my fellow Americans", 2);
    const ass = toAss([{ start: 2, end: 4.2, text: words.map((w) => w.w).join(" "), words }], style);
    const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // context-only, glow, keyword
    expect(ev.length).toBe(3);
    expect(ev[0]).toContain("0:00:02.00,0:00:03.60");
    expect(ev[0]).not.toContain("AMERICANS");
    expect(ev[1]).toContain("0:00:03.60,0:00:04.20");
    expect(ev[2]).toContain("0:00:03.60,0:00:04.20");
    expect(ev[2]).toContain("AMERICANS");
    expect(ev[2]).toContain(assColor(PUNCH_COLORS[0]));
  });

  it("keyword colours rotate per segment", () => {
    const a = mk("first important line", 0);
    const b = mk("second important line", 2);
    const ass = toAss([{ start: 0, end: 1.2, text: "x", words: a }, { start: 2, end: 3.2, text: "y", words: b }], style);
    expect(ass).toContain(assColor(PUNCH_COLORS[0]));
    expect(ass).toContain(assColor(PUNCH_COLORS[1]));
  });
});

describe("punchPlan", () => {
  it("alternates wide and punched shots, respects the gap and hold limits", () => {
    const iv = punchPlan([0, 2, 4, 6, 8, 10, 12], 14);
    expect(iv.length).toBeGreaterThan(0);
    for (const x of iv) {
      expect(x.end - x.start).toBeLessThanOrEqual(3.2);
      expect(x.end - x.start).toBeGreaterThan(0.5);
      expect(x.end).toBeLessThanOrEqual(14);
    }
    for (let i = 1; i < iv.length; i++) expect(iv[i].start).toBeGreaterThanOrEqual(iv[i - 1].end);
  });
  it("returns nothing for a clip too short to punch", () => {
    expect(punchPlan([0], 1)).toEqual([]);
  });
});

describe("cinematic_punch render args", () => {
  it("adds the punch zoom and flash expressions to the filtergraph", () => {
    const args = buildRenderArgs({ input: "/in.mp4", clipStart: 0, clipEnd: 10, srcFps: 30, hasAudio: true, aspect: "9:16", resolution: "1080p", framing: "blur", cropX: 0.5, preset: PRESETS.cinematic_punch, keep: [{ start: 0, end: 10 }], output: "/out.mp4", punchIntervals: [{ start: 2, end: 4.5 }] });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("between(t,2,4.5)");
    expect(fc).toMatch(/brightness='0\.22\*min/);
  });
});
