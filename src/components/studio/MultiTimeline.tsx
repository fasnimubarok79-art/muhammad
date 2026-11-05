"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { fmtTime } from "@/lib/client";
import type { WordCard } from "@/lib/media/cards";
import { addTrack, end, itemsOn, mainTrack, move, removeTrack, setTrack, snap, snapPoints, timelineEnd, TRACK_LABEL, trimEnd, trimStart, updateMarker, type MediaLimit } from "@/lib/timeline/ops";
import { mediaRef, TRACK_ACCEPTS, type Item, type MediaInfo, type TimelineDoc, type Track, type TrackType } from "@/lib/timeline/schema";
import type { Seg } from "./useEditor";

export const MEDIA_DRAG = "application/x-ckp-media";

type Props = {
  doc: TimelineDoc;
  media: Map<string, MediaInfo>;
  time: number;
  segments: Array<Seg & { idx: number }>;
  cards: Array<WordCard & { start: number }>;
  selection: string[];
  selectedSeg: number | null;
  onSelection: (ids: string[]) => void;
  onSelectSeg: (i: number) => void;
  onSeek: (t: number) => void;
  onDoc: (d: TimelineDoc, group: boolean) => void;
  onCardMove: (id: string, timelineStart: number, group: boolean) => void;
  onSegEdge: (idx: number, edge: "start" | "end", timelineT: number, group: boolean) => void;
  onDropMedia: (ref: string, trackId: string, frame: number) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: (ripple: boolean) => void;
  onMarker: () => void;
  limit: MediaLimit;
  /** Audio peaks of the clip window, drawn inside main-track items cut from it. */
  waveform?: { sourceVideoId: string; startSec: number; endSec: number; peaks: number[] };
};

const HEAD = 156;
const SNAP_PX = 7;
const RANK: Record<TrackType, number> = { CARDS: 0, SUBTITLE: 1, TEXT: 2, EFFECTS: 3, OVERLAY: 4, BROLL: 5, VIDEO: 6, AUDIO: 7 };
const ROW_H: Partial<Record<TrackType, number>> = { VIDEO: 46, SUBTITLE: 34, CARDS: 30 };
const CAN_MUTE: TrackType[] = ["VIDEO", "AUDIO", "BROLL", "OVERLAY"];

function Icon({ d, label }: { d: string; label: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <title>{label}</title>
      <path d={d} />
    </svg>
  );
}
const EYE = "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z";
const EYE_OFF = "M2 2l12 12 M6.5 3.8A6.6 6.6 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2 2.6 M4.1 5.2A11.7 11.7 0 0 0 1.5 8S4 12.5 8 12.5c.9 0 1.8-.2 2.5-.6";
const LOCK = "M4 7V5a4 4 0 0 1 8 0v2 M3 7h10v7H3z";
const UNLOCK = "M4 7V5a4 4 0 0 1 7.5-2 M3 7h10v7H3z";
const SPEAKER = "M2 6h3l4-3v10L5 10H2z M11.5 5.5a3.5 3.5 0 0 1 0 5";
const SPEAKER_OFF = "M2 6h3l4-3v10L5 10H2z M11 6l4 4 M15 6l-4 4";

function label(it: Item, media: Map<string, MediaInfo>) {
  if (it.kind === "text") return it.text?.text ?? "Text";
  if (it.kind === "effect") return { zoom: "Zoom in", flash: "Flash", bw: "Black & white", blur: "Blur" }[it.effects?.type ?? "zoom"];
  return media.get(mediaRef(it))?.name ?? "Missing media";
}

/** Multi-track timeline. Every edit goes through the pure ops in lib/timeline/ops, so locked tracks, overlaps and media bounds are enforced in one place. */
export function MultiTimeline(p: Props) {
  const { doc, media, time } = p;
  const fps = doc.fps;
  const [zoom, setZoom] = useState(1);
  const [snapOn, setSnapOn] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pxPerSec = 48 * zoom;
  const total = timelineEnd(doc) / fps;
  const full = Math.max((total + 6) * pxPerSec, viewW - HEAD, 10 * pxPerSec);
  const x = (sec: number) => sec * pxPerSec;
  const tracks = useMemo(() => [...doc.tracks].sort((a, b) => RANK[a.type] - RANK[b.type] || b.order - a.order), [doc.tracks]);
  const main = mainTrack(doc);
  const sel = new Set(p.selection);

  const ticks = useMemo(() => {
    const step = pxPerSec >= 120 ? 1 : pxPerSec >= 40 ? 2 : pxPerSec >= 20 ? 5 : 10;
    const out: number[] = [];
    for (let s = 0; s <= full / pxPerSec; s += step) out.push(s);
    return out;
  }, [full, pxPerSec]);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const px = x(time) + HEAD;
    if (px < el.scrollLeft + HEAD || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, px - HEAD - 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(time * 2), zoom]);

  const secAt = (clientX: number) => {
    const el = scroller.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left - HEAD + el.scrollLeft) / pxPerSec);
  };
  const thresh = () => (snapOn ? Math.round((SNAP_PX / pxPerSec) * fps) : 0);

  /** Pointer drag helper: `onMove(dxFrames, ev, first)` runs on every move until release. */
  function drag(e: RPointerEvent, onMove: (dxFrames: number, ev: PointerEvent, first: boolean) => void) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let first = true;
    const mv = (ev: PointerEvent) => {
      onMove(Math.round(((ev.clientX - x0) / pxPerSec) * fps), ev, first);
      first = false;
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  const startMove = (e: RPointerEvent, it: Item) => {
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = p.selection;
    if (multi) ids = sel.has(it.id) ? p.selection.filter((i) => i !== it.id) : [...p.selection, it.id];
    else if (!sel.has(it.id)) ids = [it.id];
    p.onSelection(ids);
    if (multi || !ids.includes(it.id)) return;
    const base = doc;
    const pts = snapPoints(base, new Set(ids), [Math.round(time * fps)]);
    let last: TimelineDoc | null = null;
    drag(e, (dx, ev, first) => {
      const s0 = it.startFrame + dx;
      const sStart = snap(s0, pts, thresh());
      const sEnd = snap(s0 + it.durationFrames, pts, thresh()) - it.durationFrames;
      const delta = (sStart !== s0 ? sStart : sEnd !== s0 ? sEnd : s0) - it.startFrame;
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-track]")?.dataset.track;
      const target = ids.length === 1 && over && over !== it.trackId ? over : undefined;
      const next = move(base, ids, delta, target) ?? (target ? move(base, ids, delta) : null);
      if (next && next !== last) {
        last = next;
        p.onDoc(next, !first);
      }
    });
  };

  const startTrim = (e: RPointerEvent, it: Item, edge: "start" | "end") => {
    p.onSelection([it.id]);
    const base = doc;
    const pts = snapPoints(base, new Set([it.id]), [Math.round(time * fps)]);
    drag(e, (dx, _ev, first) => {
      const next = edge === "start" ? trimStart(base, it.id, snap(it.startFrame + dx, pts, thresh())) : trimEnd(base, it.id, snap(end(it) + dx, pts, thresh()), p.limit);
      if (next) p.onDoc(next, !first);
    });
  };

  const scrub = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-noseek]")) return;
    p.onSeek(secAt(e.clientX));
    const mv = (ev: PointerEvent) => p.onSeek(secAt(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  const row = (tr: Track, content: ReactNode) => {
    const h = ROW_H[tr.type] ?? 34;
    const visualToggle = tr.type !== "AUDIO";
    return (
      <div key={tr.id} className={`flex border-b border-line/60 ${tr.locked ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,.025)_6px_12px)]" : ""}`} style={{ height: h }}>
        <div data-noseek className="sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r border-line bg-surface pl-2 pr-1" style={{ width: HEAD }}>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-muted" title={tr.name}>{tr.id === main.id ? "Main video" : tr.name}</span>
          {visualToggle && (
            <button className={`grid h-6 w-6 place-items-center rounded ${tr.hidden ? "text-warn" : "text-faint hover:text-ink"}`} aria-pressed={tr.hidden} aria-label={`${tr.hidden ? "Show" : "Hide"} ${tr.name}`} title={tr.hidden ? "Hidden" : "Visible"} onClick={() => p.onDoc(setTrack(doc, tr.id, { hidden: !tr.hidden }), false)}>
              <Icon d={tr.hidden ? EYE_OFF : EYE} label={tr.hidden ? "Hidden" : "Visible"} />
            </button>
          )}
          {CAN_MUTE.includes(tr.type) && (
            <button className={`grid h-6 w-6 place-items-center rounded ${tr.muted ? "text-warn" : "text-faint hover:text-ink"}`} aria-pressed={tr.muted} aria-label={`${tr.muted ? "Unmute" : "Mute"} ${tr.name}`} title={tr.muted ? "Muted" : "Sound on"} onClick={() => p.onDoc(setTrack(doc, tr.id, { muted: !tr.muted }), false)}>
              <Icon d={tr.muted ? SPEAKER_OFF : SPEAKER} label={tr.muted ? "Muted" : "Sound on"} />
            </button>
          )}
          <button className={`grid h-6 w-6 place-items-center rounded ${tr.locked ? "text-warn" : "text-faint hover:text-ink"}`} aria-pressed={tr.locked} aria-label={`${tr.locked ? "Unlock" : "Lock"} ${tr.name}`} title={tr.locked ? "Locked" : "Unlocked"} onClick={() => p.onDoc(setTrack(doc, tr.id, { locked: !tr.locked }), false)}>
            <Icon d={tr.locked ? LOCK : UNLOCK} label={tr.locked ? "Locked" : "Unlocked"} />
          </button>
        </div>
        <div
          data-track={tr.id}
          className="relative"
          style={{ width: full }}
          onDragOver={(e) => { if (TRACK_ACCEPTS[tr.type].length && e.dataTransfer.types.includes(MEDIA_DRAG)) e.preventDefault(); }}
          onDrop={(e) => {
            const ref = e.dataTransfer.getData(MEDIA_DRAG);
            if (ref) { e.preventDefault(); p.onDropMedia(ref, tr.id, Math.round(secAt(e.clientX) * fps)); }
          }}
        >
          {content}
        </div>
      </div>
    );
  };

  const itemBlock = (it: Item, tr: Track) => {
    const m = media.get(mediaRef(it));
    const selected = sel.has(it.id);
    const tone = it.kind === "audio" ? "bg-[#1E3346] border-[#3B6A8F]" : it.kind === "text" ? "bg-[#2A2440] border-[#5B4E8C]" : it.kind === "effect" ? "bg-[#33291C] border-[#7A5A2E]" : "bg-edit/15 border-edit/50";
    return (
      <div
        key={it.id}
        data-noseek
        role="button"
        tabIndex={0}
        aria-label={`${label(it, media)}, ${fmtTime(it.startFrame / fps)} to ${fmtTime(end(it) / fps)}`}
        aria-pressed={selected}
        className={`absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded border text-[11px] active:cursor-grabbing ${tone} ${selected ? "outline outline-2 outline-offset-0 outline-edit" : ""} ${tr.hidden ? "opacity-40" : ""}`}
        style={{ left: x(it.startFrame / fps), width: Math.max(4, x(it.durationFrames / fps)) }}
        onPointerDown={(e) => startMove(e, it)}
        onKeyDown={(e) => { if (e.key === "Enter") p.onSelection([it.id]); }}
        title={`${label(it, media)} (${(it.durationFrames / fps).toFixed(2)}s)${tr.locked ? " · track locked" : ""}`}
      >
        {m?.thumbUrl && it.kind !== "audio" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.thumbUrl} alt="" className="pointer-events-none h-full w-auto shrink-0 object-cover opacity-80" draggable={false} />
        )}
        {p.waveform && it.sourceVideoId === p.waveform.sourceVideoId && p.waveform.peaks.length > 0 && (() => {
          const w = p.waveform!;
          const per = w.peaks.length / Math.max(0.01, w.endSec - w.startSec);
          const a = Math.floor((it.sourceInFrame / fps - w.startSec) * per);
          const n = Math.max(1, Math.round((it.durationFrames / fps) * it.speed * per));
          const slice = Array.from({ length: n }, (_, k) => w.peaks[a + k] ?? 0);
          return (
            <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full opacity-60" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none">
              {slice.map((v, k) => <rect key={k} x={k} y={1 - v} width={0.8} height={v} fill="#3DDC97" />)}
            </svg>
          );
        })()}
        <span className="pointer-events-none relative truncate px-1.5 text-ink">{label(it, media)}{it.speed !== 1 ? ` · ${it.speed}×` : ""}{it.keyframes.length ? " ◆" : ""}</span>
        <span data-noseek className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-edit" onPointerDown={(e) => startTrim(e, it, "start")} aria-hidden />
        <span data-noseek className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-edit" onPointerDown={(e) => startTrim(e, it, "end")} aria-hidden />
      </div>
    );
  };

  const addable: TrackType[] = ["VIDEO", "BROLL", "OVERLAY", "AUDIO", "TEXT", "EFFECTS"];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5 text-[12px]">
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={p.onSplit} title="Split at the playhead (S)">Split</button>
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={p.onDuplicate} disabled={!p.selection.length} title="Duplicate (Ctrl+D)">Duplicate</button>
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => p.onDelete(false)} disabled={!p.selection.length} title="Delete (Delete)">Delete</button>
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => p.onDelete(true)} disabled={!p.selection.length} title="Ripple delete: close the gap (Shift+Delete)">Ripple delete</button>
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={p.onMarker} title="Add a marker at the playhead (M)">Marker</button>
        <label className="ml-2 flex items-center gap-1 text-muted">Zoom <input type="range" min={0.25} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-20 accent-[#FF7A1A]" aria-label="Timeline zoom" /></label>
        <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} className="accent-[#3DDC97]" /> Snap</label>
        <select aria-label="Add track" className="field h-7 w-auto px-1.5 text-[12px]" value="" onChange={(e) => { const r = addTrack(doc, e.target.value as TrackType); if (r) p.onDoc(r.doc, false); }}>
          <option value="" disabled>Add track</option>
          {addable.map((t) => <option key={t} value={t}>{TRACK_LABEL[t]}</option>)}
        </select>
        <span className="ml-auto hidden text-[11px] text-faint xl:inline">Shift+click to multi-select · drag edges to trim · drag media here from the library</span>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("[data-noseek]")) { p.onSelection([]); scrub(e); } }}>
        <div className="relative" style={{ width: full + HEAD }}>
          <div className="sticky top-0 z-20 flex h-6 border-b border-line bg-surface">
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface px-2 text-[10px] text-faint tc" style={{ width: HEAD }}>{doc.fps} fps</div>
            <div className="relative" style={{ width: full }}>
              {ticks.map((s) => <span key={s} className="absolute top-0 h-full border-l border-line pl-1 text-[10px] text-faint tc" style={{ left: x(s) }}>{fmtTime(s, false)}</span>)}
              {doc.markers.map((m) => (
                <button
                  key={m.id}
                  data-noseek
                  className="absolute top-0 h-full w-3 -translate-x-1.5 cursor-ew-resize"
                  style={{ left: x(m.frame / fps) }}
                  title={`${m.label || "Marker"} ${fmtTime(m.frame / fps)} · drag to move, double-click to rename, Shift+click to remove`}
                  aria-label={`Marker ${m.label || ""} at ${fmtTime(m.frame / fps)}`}
                  onPointerDown={(e) => {
                    if (e.shiftKey) { e.stopPropagation(); p.onDoc({ ...doc, markers: doc.markers.filter((k) => k.id !== m.id) }, false); return; }
                    p.onSeek(m.frame / fps);
                    const base = doc;
                    drag(e, (dx, _ev, first) => p.onDoc(updateMarker(base, m.id, { frame: m.frame + dx }), !first));
                  }}
                  onDoubleClick={() => { const l = window.prompt("Marker label", m.label); if (l !== null) p.onDoc(updateMarker(doc, m.id, { label: l.slice(0, 60) }), false); }}
                >
                  <span className="mx-auto block h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent" style={{ borderTopColor: m.color }} />
                </button>
              ))}
            </div>
          </div>
          {tracks.map((tr) => {
            if (tr.type === "SUBTITLE") {
              return row(tr, p.segments.map((s) => (
                <div
                  key={`${s.idx}-${s.start}`}
                  data-noseek
                  className={`absolute inset-y-1 overflow-hidden rounded border px-1.5 text-[11px] leading-[24px] ${p.selectedSeg === s.idx ? "border-edit bg-edit/25" : "border-line bg-surface2 hover:border-muted"} ${tr.hidden ? "opacity-40" : ""}`}
                  style={{ left: x(s.start), width: Math.max(4, x(s.end - s.start)) }}
                  onPointerDown={(e) => { e.stopPropagation(); p.onSelectSeg(s.idx); p.onSeek(s.start); }}
                  title={s.text}
                >
                  <span className="pointer-events-none truncate">{s.text}</span>
                  {!tr.locked && <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-edit" onPointerDown={(e) => { const s0 = s.start; drag(e, (dx, _ev, first) => p.onSegEdge(s.idx, "start", s0 + dx / fps, !first)); }} />}
                  {!tr.locked && <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-edit" onPointerDown={(e) => { const s1 = s.end; drag(e, (dx, _ev, first) => p.onSegEdge(s.idx, "end", s1 + dx / fps, !first)); }} />}
                </div>
              )));
            }
            if (tr.type === "CARDS") {
              return row(tr, p.cards.map((c) => (
                <div
                  key={`${c.id}-${c.start}`}
                  data-noseek
                  className={`absolute inset-y-1 cursor-grab overflow-hidden rounded border border-line px-1.5 text-[11px] leading-[20px] hover:border-muted active:cursor-grabbing ${tr.hidden ? "opacity-40" : ""}`}
                  style={{ left: x(c.start), width: Math.max(6, x(c.dur)), background: c.bg, color: c.color, fontFamily: c.font === "serif" ? '"Instrument Serif", Georgia, serif' : undefined, fontStyle: c.italic ? "italic" : undefined }}
                  title={`Card: ${c.text} (drag to move)`}
                  onPointerDown={(e) => { if (tr.locked) return; p.onSeek(c.start); const s0 = c.start; drag(e, (dx, _ev, first) => p.onCardMove(c.id, s0 + dx / fps, !first)); }}
                >
                  <span className="pointer-events-none truncate">{c.text}</span>
                </div>
              )));
            }
            return row(tr, <>
              {itemsOn(doc, tr.id).map((it) => itemBlock(it, tr))}
              {doc.tracks.filter((o) => o.type === tr.type).length > 1 && removeTrack(doc, tr.id) && (
                <button data-noseek className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-faint hover:text-danger" onClick={() => { const r = removeTrack(doc, tr.id); if (r) p.onDoc(r, false); }}>Remove empty track</button>
              )}
            </>);
          })}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 z-30 w-px bg-edit" style={{ left: HEAD + x(time) }}>
            <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 bg-edit" />
          </div>
        </div>
      </div>
    </div>
  );
}
