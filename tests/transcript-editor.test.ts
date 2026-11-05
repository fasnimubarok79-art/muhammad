import { describe, expect, it } from "vitest";
import { retext, retime, splitAt, type Seg, type Word } from "@/components/studio/useEditor";

const mkWord = (w: string, s: number, e: number): Word => ({ w, s, e });

const seg = (text: string, start: number, end: number, words: Word[]): Seg => ({
  start, end, text, words,
});

const base: Seg[] = [
  seg("hello world", 0, 1.2, [mkWord("hello", 0, 0.6), mkWord("world", 0.6, 1.2)]),
  seg("how are you", 1.2, 2.4, [mkWord("how", 1.2, 1.6), mkWord("are", 1.6, 2.0), mkWord("you", 2.0, 2.4)]),
];

describe("transcript editor core edits", () => {
  it("retext rewrites words one-to-one keeping timings when lengths match", () => {
    const out = retext(base[0], "hi there");
    expect(out.text).toBe("hi there");
    expect(out.words.map((w) => w.w)).toEqual(["hi", "there"]);
    expect(out.words[0].s).toBe(0);
    expect(out.words[1].e).toBe(1.2);
  });

  it("retext spreads words evenly when word count changes", () => {
    const out = retext(base[0], "a b c");
    expect(out.text).toBe("a b c");
    expect(out.words).toHaveLength(3);
    expect(out.words[0].s).toBeCloseTo(0, 5);
    expect(out.words[2].e).toBeCloseTo(1.2, 5);
  });

  it("retime scales all word times into a new window", () => {
    const out = retime(base[1], 5, 7);
    expect(out.start).toBe(5);
    expect(out.end).toBe(7);
    // "how" was 1.2->1.6 (first third); scaled into 5->7 -> 5.0->5.667
    expect(out.words[0].s).toBeCloseTo(5, 5);
    expect(out.words[0].e).toBeCloseTo(5 + (1.6 - 1.2) * (2 / 1.2), 5);
  });

  it("splitAt divides a line at a word boundary", () => {
    const out = splitAt([base[0]], 0.9)!;
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("hello");
    expect(out[1].text).toBe("world");
    expect(out[0].end).toBe(0.6);
    expect(out[1].start).toBe(0.6);
  });

  it("splitAt returns null when t is outside any line", () => {
    expect(splitAt(base, 5)).toBeNull();
    expect(splitAt(base, 0)).toBeNull();
  });

  it("splitAt splits on the nearest word boundary", () => {
    const out = splitAt([base[1]], 1.8)!; // inside "are" (1.6-2.0), boundary at 2.0
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("how are");
    expect(out[1].text).toBe("you");
  });
});
