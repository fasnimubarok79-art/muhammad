"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { fmtTime } from "@/lib/client";
import type { WordCard } from "@/lib/media/cards";
import { retime, type Config, type Seg } from "./useEditor";

type Props = {
  clipLen: number;
  time: number;
  segments: Seg[];
  config: Config;
  silences: Array<{ start: number; end: number }>;
  peaks: number[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  onSeek: (t: number) => void;
  onSegments: (segs: Seg[], group: boolean) => void;
  onTrim: (start: number, end: number, group: boolean) => void;
  onCards: (cards: WordCard[], group: boolean) => void;
};

const SNAP_PX = 6;

function Track({ label, children, h = 40, full }: { label: string; children: React.ReactNode; h?: number; full: number }) {
  return (
    <div className="flex" style={{ height: h }}>
      <div className="sticky left-0 z-10 flex w-24 shrink-0 items-center border-r border-line bg-surface px-2 text-[11px] font-semibold text-muted">{label}</div>
      <div className="relative" style={{ width: full }}>{children}</div>
    </div>
  );
}

export function Timeline({ clipLen, time, segments, config, silences, peaks, selected, onSelect, onSeek, onSegments, onTrim, onCards }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 96));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = (width * zoom) / Math.max(clipLen, 0.1);
  const full = clipLen * pxPerSec;
  const x = (t: number) => t * pxPerSec;

  // snap targets: word boundaries, segment edges, trim points, playhead
  const snapPoints = useMemo(() => {
    const pts = [0, clipLen, config.trimStart, config.trimEnd, time];
    segments.forEach((s) => {
      pts.push(s.start, s.end);
      s.words.forEach((w) => pts.push(w.s, w.e));
    });
    return pts;
  }, [segments, config.trimStart, config.trimEnd, clipLen, time]);
  const snapT = (t: number) => {
    if (!snap) return t;
    let best = t;
    let d = SNAP_PX / pxPerSec;
    for (const p of snapPoints) if (Math.abs(p - t) < d) { d = Math.abs(p - t); best = p; }
    return best;
  };

  // waveform from real audio peaks
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(full * dpr));
    c.height = 40 * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "#3DDC97";
    const n = peaks.length;
    if (!n) return;
    const bw = c.width / n;
    peaks.forEach((p, i) => {
      const h = Math.max(1, p * c.height * 0.95);
      g.fillRect(i * bw, (c.height - h) / 2, Math.max(1, bw - dpr * 0.5), h);
    });
  }, [peaks, full]);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const px = x(time) + 96;
    if (px < el.scrollLeft + 96 || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = px - 120;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(time * 2), zoom]);

  function timeFromEvent(e: { clientX: number }) {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(clipLen, (e.clientX - rect.left - 96 + el.scrollLeft) / pxPerSec));
  }

  function drag(e: RPointerEvent, onMove: (t: number, first: boolean) => void) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    let first = true;
    const move = (ev: PointerEvent) => {
      onMove(snapT(timeFromEvent(ev)), first);
      first = false;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const moveSegEdge = (i: number, edge: "start" | "end") => (e: RPointerEvent) =>
    drag(e, (t, first) => {
      const s = segments[i];
      const prevEnd = i > 0 ? segments[i - 1].end : 0;
      const nextStart = i < segments.length - 1 ? segments[i + 1].start : clipLen;
      const next = [...segments];
      if (edge === "start") next[i] = retime(s, Math.max(prevEnd, Math.min(t, s.end - 0.1)), s.end);
      else next[i] = retime(s, s.start, Math.min(nextStart, Math.max(t, s.start + 0.1)));
      onSegments(next, !first);
    });

  const ticks = useMemo(() => {
    const step = pxPerSec > 120 ? 0.5 : pxPerSec > 50 ? 1 : pxPerSec > 20 ? 2 : 5;
    const out: number[] = [];
    for (let t = 0; t <= clipLen + 0.001; t += step) out.push(Number(t.toFixed(2)));
    return out;
  }, [pxPerSec, clipLen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-1.5 text-[12px]">
        <span className="font-semibold">Timeline</span>
        <label className="flex items-center gap-2 text-muted">
          Zoom
          <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24 accent-[#3DDC97]" aria-label="Timeline zoom" />
          <span className="tc w-8">{zoom}x</span>
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-[#3DDC97]" /> Snap
        </label>
        <span className="ml-auto hidden text-faint md:inline">Space play · S split · Delete remove line · Ctrl+Z undo · ←/→ nudge</span>
      </div>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-noseek]")) return;
          const t = timeFromEvent(e);
          if (t >= 0) onSeek(snapT(t));
          drag(e, (tt) => onSeek(tt));
        }}
      >
        <div style={{ width: full + 96 }} className="relative">
          <Track full={full} label="" h={22}>
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 h-full border-l border-line pl-1 text-[10px] text-faint tc" style={{ left: x(t) }}>{fmtTime(t, false)}</span>
            ))}
          </Track>
          <Track full={full} label="Video">
            <div className="absolute inset-y-1 rounded bg-surface2" style={{ left: 0, width: full }} />
            <div className="absolute inset-y-1 rounded border border-edit/60 bg-edit/15" style={{ left: x(config.trimStart), width: x(config.trimEnd - config.trimStart) }} />
            <div data-noseek role="slider" aria-label="Trim in" aria-valuenow={Number(config.trimStart.toFixed(2))} tabIndex={0} className="absolute inset-y-0 w-2 cursor-ew-resize rounded-l bg-edit" style={{ left: x(config.trimStart) }} onPointerDown={(e) => drag(e, (t, first) => onTrim(Math.min(t, config.trimEnd - 0.5), config.trimEnd, !first))} />
            <div data-noseek role="slider" aria-label="Trim out" aria-valuenow={Number(config.trimEnd.toFixed(2))} tabIndex={0} className="absolute inset-y-0 w-2 -translate-x-2 cursor-ew-resize rounded-r bg-edit" style={{ left: x(config.trimEnd) }} onPointerDown={(e) => drag(e, (t, first) => onTrim(config.trimStart, Math.max(t, config.trimStart + 0.5), !first))} />
          </Track>
          <Track full={full} label="Audio">
            <canvas ref={canvas} className="absolute inset-0 h-full" style={{ width: full }} aria-label="Audio waveform" />
            {config.removeSilence && silences.filter((s) => s.end - s.start >= 0.6).map((s, i) => (
              <div key={i} className="absolute inset-y-0 bg-danger/25" style={{ left: x(s.start), width: x(s.end - s.start) }} title="Removed by silence removal" />
            ))}
          </Track>
          <Track full={full} label="Subtitles" h={44}>
            {segments.map((s, i) => (
              <div
                key={i}
                data-noseek
                className={`absolute inset-y-1 overflow-hidden rounded border px-1.5 text-[11px] leading-[34px] ${selected === i ? "border-edit bg-edit/25" : "border-line bg-surface2 hover:border-muted"}`}
                style={{ left: x(s.start), width: Math.max(4, x(s.end - s.start)) }}
                onPointerDown={(e) => { e.stopPropagation(); onSelect(i); onSeek(s.start); }}
                title={s.text}
              >
                <span className="pointer-events-none truncate">{s.text}</span>
                <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-edit/0 hover:bg-edit" onPointerDown={moveSegEdge(i, "start")} />
                <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-edit/0 hover:bg-edit" onPointerDown={moveSegEdge(i, "end")} />
              </div>
            ))}
          </Track>
          <Track full={full} label="Cards" h={30}>
            {(config.cards ?? []).map((c) => (
              <div
                key={c.id}
                data-noseek
                className="absolute inset-y-1 cursor-grab overflow-hidden rounded border border-line px-1.5 text-[11px] leading-[20px] hover:border-muted active:cursor-grabbing"
                style={{ left: x(c.at), width: Math.max(6, x(c.dur)), background: c.bg, color: c.color, fontFamily: c.font === "serif" ? '"Instrument Serif", Georgia, serif' : undefined, fontStyle: c.italic ? "italic" : undefined }}
                title={`Card: ${c.text} (drag to move)`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const off = timeFromEvent(e) - c.at;
                  const cards = config.cards ?? [];
                  onSeek(c.at);
                  drag(e, (t, first) => {
                    const at = Math.max(0, Math.min(clipLen - c.dur, t - off));
                    onCards(cards.map((k) => (k.id === c.id ? { ...k, at: Number(at.toFixed(3)) } : k)), !first);
                  });
                }}
              >
                <span className="pointer-events-none truncate">{c.text}</span>
              </div>
            ))}
          </Track>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-px bg-edit" style={{ left: 96 + x(time) }}>
            <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 bg-edit" />
          </div>
        </div>
      </div>
    </div>
  );
}
