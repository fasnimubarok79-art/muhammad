import { describe, expect, it } from "vitest";
import { cardEvents, cardLines, cardSchema, cardsSchema, CARD_STYLE_LINE, newCard, placeCards, activeCard } from "@/lib/media/cards";
import { keepIntervals, mapTime } from "@/lib/media/render";
import { DEFAULT_STYLE, toAss } from "@/lib/media/subtitles";

describe("word cards", () => {
  it("new cards pass the server schema; bad input is rejected", () => {
    expect(cardSchema.safeParse(newCard(1, "yang")).success).toBe(true);
    expect(cardSchema.safeParse({ ...newCard(1, "x"), color: "red" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...newCard(1, "x"), text: "" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...newCard(1, "x"), dur: 30 }).success).toBe(false);
    expect(cardsSchema.safeParse(Array.from({ length: 41 }, (_, i) => newCard(i, "x"))).success).toBe(false);
  });

  it("emits a full-frame background above the subtitle layers, timed to the card", () => {
    const c = { ...newCard(0, "lebih", "grid"), start: 2.5, dur: 1.2 };
    const ev = cardEvents([c]);
    expect(ev.length).toBeGreaterThanOrEqual(3); // background, grid, edge shade, text
    for (const e of ev) {
      expect(e).toContain("0:00:02.50,0:00:03.70");
      expect(Number(e.split(",")[0].split(" ")[1])).toBeGreaterThanOrEqual(10);
    }
    expect(ev[0]).toContain("m 0 0 l 1080 0 1080 1920 0 1920");
    const text = ev[ev.length - 1];
    expect(text).toContain("\\fnInstrument Serif");
    expect(text).toContain("\\pos(540,960)");
    expect(text).toContain("lebih");
  });

  it("escapes ASS override braces in card text", () => {
    const ev = cardEvents([{ ...newCard(0, "{\\pos(0,0)}hi", "black"), start: 0 }]);
    expect(ev.join("\n")).not.toContain("{\\pos(0,0)}hi");
  });

  it("toAss merges card styles and events into one script", () => {
    const ass = toAss([], DEFAULT_STYLE, { w: 1080, h: 1920 }, { styles: [CARD_STYLE_LINE], events: cardEvents([{ ...newCard(0, "x", "accent"), start: 0 }]) });
    expect(ass).toContain("Style: Card,");
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length).toBeGreaterThan(1);
  });

  it("long phrases wrap to at most two lines, the same for render and preview", () => {
    const lines = cardLines({ text: "yang menimpa dia setiap hari", size: 150, upper: true }, 1080);
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toBe("YANG MENIMPA DIA SETIAP HARI");
  });

  it("placeCards follows trim and silence cuts and drops cards outside the window", () => {
    const keep = keepIntervals(10, [{ start: 2, end: 4 }]);
    const out = keep.reduce((a, k) => a + k.end - k.start, 0);
    const cards = [newCard(1, "a"), newCard(5, "b"), newCard(0.5, "before-trim"), newCard(20, "after")];
    const placed = placeCards(cards, 1, 10, out, (t) => mapTime(t, keep));
    expect(placed.map((c) => c.text)).toEqual(["a", "b"]);
    expect(placed[0].start).toBeCloseTo(0, 5);
    // 5s clip time = 4s window time, after a cut of about 2s minus padding
    expect(placed[1].start).toBeLessThan(4);
    expect(placed[1].start).toBeCloseTo(mapTime(4, keep)!, 5);
  });

  it("activeCard finds the card under the playhead", () => {
    const cards = [newCard(1, "a"), newCard(3, "b")];
    expect(activeCard(cards, 1.5)?.text).toBe("a");
    expect(activeCard(cards, 2.5)).toBeNull();
  });
});
