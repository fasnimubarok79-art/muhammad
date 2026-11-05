import { describe, expect, it } from "vitest";
import { assColor, toAss, DEFAULT_STYLE, HORMOZI_STYLE, type SubtitleStyle } from "@/lib/media/subtitles";

const mk = (text: string, start: number, step = 0.4) =>
  text.split(" ").map((w, i) => ({ w, s: start + i * step, e: start + i * step + step * 0.9 }));

const style = { ...DEFAULT_STYLE, ...HORMOZI_STYLE } as SubtitleStyle;

describe("hormozi / Pro Shorts subtitles", () => {
  it("gives every word its own event, timed to the word", () => {
    const words = mk("hey guys listen up", 0);
    const ass = toAss([{ start: 0, end: 3.6, text: words.map((w) => w.w).join(" "), words }], style);
    const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(ev.length).toBe(4);
    expect(ev[0]).toContain("0:00:00.00,0:00:00.40");
    expect(ev[1]).toContain("0:00:00.40,0:00:00.80");
    expect(ev[3]).toContain("0:00:01.20,0:00:03.60");
  });

  it("highlights the active word with bright colour, thick outline, shadow, and \\t \\fscx \\fscy pop", () => {
    const words = mk("hey guys listen up", 0);
    const ass = toAss([{ start: 0, end: 3.6, text: words.map((w) => w.w).join(" "), words }], style);
    const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // First event: first word active
    expect(ev[0]).toContain("hey");
    expect(ev[0]).toContain(assColor(style.highlight!));
    expect(ev[0]).toContain("\\3c&H000000&"); // black outline
    expect(ev[0]).toContain("\\shad"); // shadow
    expect(ev[0]).toContain("\\t(0,40,"); // transform over word duration
    expect(ev[0]).toContain("\\fscx135\\fscy135"); // scale up
    expect(ev[0]).toContain("{\\r}"); // reset after word
  });

  it("renders inactive words white with black outline and shadow", () => {
    const words = mk("hey guys listen up", 0);
    const ass = toAss([{ start: 0, end: 3.6, text: words.map((w) => w.w).join(" "), words }], style);
    const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // Second event: second word active, first word inactive
    expect(ev[1]).toContain("guys");
    expect(ev[1]).toContain(assColor(style.highlight!)); // guys is highlighted
    expect(ev[1]).toContain(assColor(style.primary!)); // hey is white (inactive)
    expect(ev[1]).toContain("\\3c&H000000&"); // black outline on all words
  });

  it("uses HORMOZI_STYLE defaults", () => {
    expect(style.preset).toBe("hormozi");
    expect(style.highlight).toBe("#FFD21F");
    expect(style.outline).toBe(12);
    expect(style.shadow).toBe(6);
    expect(style.maxCharsPerLine).toBe(14);
    expect(style.popScale).toBe(1.35);
  });

  it("renders popScale as \\fscx / \\fscy in the active word animation", () => {
    const words = mk("hey guys listen up", 0);
    const custom = { ...style, popScale: 1.5 };
    const ass = toAss([{ start: 0, end: 3.6, text: words.map((w) => w.w).join(" "), words }], custom);
    const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(ev[0]).toContain("\\t(0,40,\\fscx150\\fscy150)");
    // inactive popScale 1.0 renders no animation
    // inactive popScale 1.0 renders no visible pop (hormozi path with scale 1.0)
    // inactive popScale 1.0 renders no visible pop (hormozi path with scale 1.0)
    const plain: SubtitleStyle = {
      preset: "hormozi",
      fontName: "Inter Black",
      fontSize: 110,
      primary: "#FFFFFF",
      highlight: "#FFD21F",
      outline: 12,
      shadow: 6,
      marginV: 700,
      maxCharsPerLine: 14,
      popScale: 1.0,
    };
    const ass2 = toAss([{ start: 0, end: 0.4, text: "hey", words: [{ w: "hey", s: 0, e: 0.4 }] }], plain);
    const ev2 = ass2.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(ev2[0]).toContain("\\t(0,40,\\fscx100\\fscy100)"); // 1.0 = no visible pop
  });
});
