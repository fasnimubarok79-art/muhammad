import { describe, expect, it } from "vitest";
import { blankItem, defaultTimeline } from "@/lib/timeline/defaults";
import { kfExpr, propValue, valueAt } from "@/lib/timeline/keyframes";
import { mapCards, mapSegments, srcToTimeline, timelineToSrc } from "@/lib/timeline/mapping";
import { addItem, addMarker, addTrack, cutRanges, duplicate, end, isFree, mainTrack, move, remove, removeTrack, setTrack, snap, snapPoints, split, trimEnd, trimStart } from "@/lib/timeline/ops";
import { timelineSchema, type TimelineDoc } from "@/lib/timeline/schema";
import { newCard } from "@/lib/media/cards";

const clip = { startSec: 10, endSec: 20, sourceVideoId: "src1" };
const base = () => defaultTimeline({ clip, sourceDurationSec: 60, aspect: "9:16", id: "tl1" });
const limit = () => 60 * 30; // 60 s source
const mainItems = (d: TimelineDoc) => d.items.filter((i) => i.trackId === mainTrack(d).id).sort((a, b) => a.startFrame - b.startFrame);

describe("default timeline", () => {
  it("puts the clip window on the main track in whole frames and passes the schema", () => {
    const d = base();
    expect(timelineSchema.safeParse(d).success).toBe(true);
    expect(d.tracks.map((t) => t.type).sort()).toEqual(["AUDIO", "BROLL", "CARDS", "EFFECTS", "OVERLAY", "SUBTITLE", "TEXT", "VIDEO"]);
    const [m] = mainItems(d);
    expect(m).toMatchObject({ startFrame: 0, durationFrames: 300, sourceInFrame: 300, sourceVideoId: "src1" });
  });
  it("keeps an old clip's trim and silence removal", () => {
    const d = defaultTimeline({ clip, sourceDurationSec: 60, aspect: "9:16", trimStart: 1, trimEnd: 9, removeSilence: true, silences: [{ start: 14, end: 16 }] });
    const items = mainItems(d);
    expect(items.length).toBe(2);
    expect(items[0].sourceInFrame).toBe(330);
    expect(items[1].startFrame).toBe(end(items[0])); // gap closed
    expect(items.reduce((a, i) => a + i.durationFrames, 0)).toBeLessThan(240);
  });
});

describe("editing operations", () => {
  it("split keeps both halves and the full source range", () => {
    const d = base();
    const r = split(d, 120)!;
    const [a, b] = mainItems(r.doc);
    expect([a.durationFrames, b.durationFrames]).toEqual([120, 180]);
    expect(b.sourceInFrame).toBe(a.sourceInFrame + 120);
    expect(b.startFrame).toBe(end(a));
    expect(split(d, 0)).toBeNull(); // on an edge: nothing to split
  });
  it("trim moves source in with the left edge and stops at the media end", () => {
    const d = base();
    const id = mainItems(d)[0].id;
    const t = trimStart(d, id, 30)!;
    expect(mainItems(t)[0]).toMatchObject({ startFrame: 30, durationFrames: 270, sourceInFrame: 330 });
    expect(trimEnd(d, id, 400, limit)!.items.find((i) => i.id === id)!.durationFrames).toBe(400);
    expect(trimEnd(d, id, 2000, limit)).toBeNull(); // past the 60 s source
  });
  it("move keeps duration and source range, and refuses overlaps", () => {
    const d = split(base(), 150)!.doc;
    const [a, b] = mainItems(d);
    expect(move(d, [b.id], -10)).toBeNull(); // would overlap a
    const m = move(d, [b.id], 60)!;
    const mb = m.items.find((i) => i.id === b.id)!;
    expect(mb).toMatchObject({ startFrame: 210, durationFrames: b.durationFrames, sourceInFrame: b.sourceInFrame });
    expect(move(d, [a.id, b.id], 30)!.items.find((i) => i.id === a.id)!.startFrame).toBe(30); // group move
  });
  it("duplicate copies settings into the next free space", () => {
    const d = base();
    const id = mainItems(d)[0].id;
    const withKf = { ...d, items: d.items.map((i) => (i.id === id ? { ...i, opacity: 0.5, keyframes: [{ prop: "scale" as const, frame: 0, value: 1, ease: "ease" as const }] } : i)) };
    const r = duplicate(withKf, [id])!;
    const copy = r.doc.items.find((i) => i.id === r.created[0])!;
    expect(copy).toMatchObject({ startFrame: 300, opacity: 0.5, sourceInFrame: 300 });
    expect(copy.keyframes).toHaveLength(1);
  });
  it("delete leaves a gap; ripple delete closes it on that track only", () => {
    let d = split(split(base(), 100)!.doc, 200)!.doc;
    const ov = d.tracks.find((t) => t.type === "OVERLAY")!;
    d = addItem(d, { ...blankItem(ov.id, "image", 60, { mediaAssetId: "img1" }) }, 250)!.doc;
    const [, mid, last] = mainItems(d);
    const plain = remove(d, [mid.id])!;
    expect(mainItems(plain)[1].startFrame).toBe(200);
    const rip = remove(d, [mid.id], true)!;
    expect(mainItems(rip)[1]).toMatchObject({ startFrame: 100, sourceInFrame: last.sourceInFrame });
    expect(rip.items.find((i) => i.trackId === ov.id)!.startFrame).toBe(250); // other tracks untouched
  });
  it("locked tracks refuse every edit", () => {
    const d = base();
    const locked = setTrack(d, mainTrack(d).id, { locked: true });
    const id = mainItems(d)[0].id;
    expect(split(locked, 100)).toBeNull();
    expect(move(locked, [id], 10)).toBeNull();
    expect(trimStart(locked, id, 10)).toBeNull();
    expect(remove(locked, [id])).toBeNull();
    expect(duplicate(locked, [id])).toBeNull();
  });
  it("cut silences splits and closes the gaps without touching other media", () => {
    const d = base();
    const r = cutRanges(d, mainTrack(d).id, { sourceVideoId: "src1" }, [{ start: 12, end: 13 }, { start: 15, end: 15.5 }])!;
    const items = mainItems(r);
    expect(items.map((i) => [i.startFrame, i.durationFrames, i.sourceInFrame])).toEqual([[0, 60, 300], [60, 60, 390], [120, 135, 465]]);
  });
  it("tracks: add, refuse removing a used or main track, markers and snapping", () => {
    const d = base();
    const t = addTrack(d, "OVERLAY")!;
    expect(t.doc.tracks.filter((x) => x.type === "OVERLAY")).toHaveLength(2);
    expect(removeTrack(t.doc, t.id)!.tracks).toHaveLength(d.tracks.length);
    expect(removeTrack(d, mainTrack(d).id)).toBeNull();
    expect(addTrack(d, "SUBTITLE")).toBeNull();
    const m = addMarker(d, 95, "hook");
    expect(snap(97, snapPoints(m.doc, new Set()), 3)).toBe(95);
    expect(snap(110, snapPoints(m.doc, new Set()), 3)).toBe(110);
    expect(isFree(d, mainTrack(d).id, 300, 10)).toBe(true);
  });
  it("the schema rejects overlaps and items on the wrong track", () => {
    const d = base();
    const [m] = mainItems(d);
    expect(timelineSchema.safeParse({ ...d, items: [...d.items, { ...m, id: "dup1", startFrame: 100 }] }).success).toBe(false);
    const audio = d.tracks.find((t) => t.type === "AUDIO")!;
    expect(timelineSchema.safeParse({ ...d, items: [{ ...m, trackId: audio.id }] }).success).toBe(false);
  });
});

describe("keyframes", () => {
  const kfs = [
    { prop: "x" as const, frame: 0, value: 0, ease: "linear" as const },
    { prop: "x" as const, frame: 30, value: 1, ease: "ease" as const },
    { prop: "x" as const, frame: 60, value: 0, ease: "linear" as const },
  ];
  it("interpolates linear and eased segments and holds outside them", () => {
    expect(valueAt(kfs, 15, 9)).toBeCloseTo(0.5);
    expect(valueAt(kfs, 45, 9)).toBeCloseTo(0.5); // smoothstep midpoint
    expect(valueAt(kfs, 37.5, 9)).toBeCloseTo(1 - 0.15625); // eased, not linear (0.75)
    expect(valueAt(kfs, 100, 9)).toBe(0);
    expect(propValue(kfs, "scale", 10, 1.2)).toBe(1.2);
  });
  it("the FFmpeg expression gives the same values as the preview", () => {
    const expr = kfExpr(kfs, 0, 30, 2); // item starts at 2 s on the timeline
    const js = expr.replace(/if\(/g, "iff(").replace(/lt\(/g, "ltf(");
    const evalAt = (t: number) => Function("t", "iff", "ltf", `return ${js}`)(t, (c: boolean, a: number, b: number) => (c ? a : b), (a: number, b: number) => a < b);
    for (const f of [0, 10, 15, 30, 37.5, 45, 59, 70]) expect(evalAt(2 + f / 30)).toBeCloseTo(valueAt(kfs, f, 0), 4);
  });
});

describe("speech mapping", () => {
  const segs = [{ start: 1, end: 2, text: "hello world", words: [{ w: "hello", s: 1, e: 1.4 }, { w: "world", s: 1.5, e: 2 }] }];
  it("subtitles and cards follow the main-track items they belong to", () => {
    let d = split(base(), 60)!.doc; // cut at 2 s timeline = source 12 s
    const [, b] = mainItems(d);
    d = move(d, [b.id], 30)!; // second half 1 s later
    expect(srcToTimeline(d, "src1", 11)).toEqual([1]);
    expect(srcToTimeline(d, "src1", 13)[0]).toBeCloseTo(4);
    expect(timelineToSrc(d, "src1", 2.5)).toBeNull(); // the gap
    const mapped = mapSegments(d, "src1", 10, segs);
    expect(mapped[0].words.map((w) => w.s)).toEqual([1, 1.5]);
    const late = mapSegments(d, "src1", 10, [{ start: 2.5, end: 3, text: "later", words: [{ w: "later", s: 2.5, e: 3 }] }]);
    expect(late[0].start).toBeCloseTo(3.5);
    expect(mapCards(d, "src1", 10, [newCard(2.5, "x")])[0].start).toBeCloseTo(3.5);
  });
  it("speech that was cut away loses its captions", () => {
    const cut = split(base(), 60)!.doc;
    const d = remove(cut, [mainItems(cut)[0].id])!;
    expect(mapSegments(d, "src1", 10, segs)).toEqual([]);
  });
});
