"use client";

import { useCallback, useMemo, useState } from "react";
import { fmtTime } from "@/lib/client";
import { useToast } from "../ui/use-toast";
import { retext, retime, splitAt, type Seg, type Word } from "./useEditor";
import { activeSubtitle } from "@/lib/timeline/preview";

/**
 * Transcript Editor: word-level subtitle editing for the Subtitle Studio.
 *
 * Lists every subtitle segment with all its words shown inline. Users can fix
 * typos word by word, nudge word start/end times, merge adjacent lines, split
 * a line at the playhead, and add new lines. The word under the playhead is
 * highlighted in real time so edits stay in sync with the preview.
 *
 * Edits flow through `onSegments`, which the Studio wires to `useEditor.commit`
 * (undo/redo, debounced server save). The preview re-renders automatically.
 */
export function TranscriptEditor({ doc, time, clipLen, onSegments, onSeek }: {
  doc: { segments: Seg[] };
  time: number | null;
  clipLen: number;
  onSegments: (segs: Seg[], group?: boolean) => void;
  onSeek: (t: number) => void;
}) {
  const toast = useToast();
  const segs = doc.segments;
  const [editingSeg, setEditingSeg] = useState<number | null>(null);
  const [segDraft, setSegDraft] = useState("");
  const [editingWord, setEditingWord] = useState<{ segIdx: number; wordIdx: number } | null>(null);
  const [wordDraft, setWordDraft] = useState("");

  const active = time !== null ? activeSubtitle(segs, time) : null;
  const activeSegIdx = active ? segs.indexOf(active.seg) : null;
  const activeWordIdx = active ? active.idx : null;

  const update = useCallback((i: number, s: Seg, group = true) => onSegments(segs.map((x, k) => (k === i ? s : x)), group), [segs, onSegments]);

  // ---------- segment-level text ----------
  const handleSegTextChange = useCallback((i: number, e: React.ChangeEvent<HTMLTextAreaElement>) => {
    update(i, retext(segs[i], e.target.value.replace(/\s+/g, " ").trim()));
  }, [segs, update]);

  const startEditSeg = useCallback((i: number) => {
    setEditingSeg(i);
    setSegDraft(segs[i].text);
  }, [segs]);

  const finishEditSeg = useCallback(() => {
    setEditingSeg(null);
    setSegDraft("");
  }, []);

  // ---------- word-level text ----------
  const handleWordText = useCallback((segIdx: number, wordIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.trim();
    const s = segs[segIdx];
    const words = [...s.words];
    words[wordIdx] = { ...words[wordIdx], w: v };
    const text = words.map((w) => w.w).join(" ");
    update(segIdx, retext(s, text));
  }, [segs, update]);

  const startEditWord = useCallback((segIdx: number, wordIdx: number) => {
    setEditingWord({ segIdx, wordIdx });
    setWordDraft(segs[segIdx].words[wordIdx].w);
  }, [segs]);

  const finishEditWord = useCallback(() => {
    setEditingWord(null);
    setWordDraft("");
  }, []);

  // ---------- word timing ----------
  const handleWordTime = useCallback((segIdx: number, wordIdx: number, field: "s" | "e", v: number) => {
    const s = segs[segIdx];
    const words = [...s.words];
    const prev = words[wordIdx - 1];
    const next = words[wordIdx + 1];
    const lo = field === "s" ? (prev ? prev.e + 0.05 : 0) : (prev ? prev.e + 0.05 : 0);
    const hi = field === "e" ? (next ? next.s - 0.05 : clipLen + 0.01) : (next ? next.s - 0.05 : s.end);
    if (v < lo || v > hi) return;
    words[wordIdx] = { ...words[wordIdx], [field]: v };
    update(segIdx, { ...s, words });
  }, [segs, update, clipLen]);

  // ---------- segment structure ----------
  const handleMerge = useCallback((i: number) => {
    if (i >= segs.length - 1) return;
    const a = segs[i];
    const b = segs[i + 1];
    const words = [...a.words, ...b.words];
    const merged = { ...a, end: b.end, text: words.map((w) => w.w).join(" "), words };
    onSegments(segs.filter((_, k) => k !== i && k !== i + 1).concat(merged).sort((x, y) => x.start - y.start));
  }, [segs, onSegments]);

  const handleSplit = useCallback((i: number) => {
    if (time === null) return;
    const n = splitAt(segs, time);
    if (n) onSegments(n);
  }, [segs, time, onSegments]);

  const handleAdd = useCallback(() => {
    if (time === null) return toast({ tone: "error", title: "Put the playhead over the clip" });
    const start = Math.max(0, time);
    const after = segs.find((s) => s.start > start);
    const end = Math.min(start + 1.5, after ? after.start : clipLen, clipLen);
    if (end - start < 0.2 || segs.some((s) => start >= s.start && start < s.end)) return toast({ tone: "error", title: "Move to a gap without subtitles" });
    const n = [...segs, { start, end, text: "New line", words: [{ w: "New", s: start, e: (start + end) / 2, p: -1 }, { w: "line", s: (start + end) / 2, e: end, p: -1 }] }].sort((a, b) => a.start - b.start);
    onSegments(n);
  }, [segs, time, clipLen, onSegments, toast]);

  const handleDelete = useCallback((i: number) => {
    onSegments(segs.filter((_, k) => k !== i));
  }, [segs, onSegments]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2">
        <button className="btn-secondary h-8 px-2.5 text-[12px]" onClick={handleAdd}>Add at playhead</button>
        <span className="text-[11px] text-faint">{segs.length} line{segs.length === 1 ? "" : "s"}</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {segs.length === 0 && (
          <li className="p-3 text-[13px] text-muted">No subtitles yet. Add a line at the playhead or import captions.</li>
        )}
        {segs.map((s, i) => {
          const live = activeSegIdx === i && activeWordIdx !== null;
          const expanded = editingSeg === i;
          return (
            <li key={i} className={`border-b border-line px-2 py-2 ${expanded ? "bg-surface2/60" : ""}`}>
              <div className="flex items-center gap-1.5 text-[11px] tc mb-1.5">
                <button className={`rounded px-1 ${live ? "bg-edit text-bg" : "text-muted hover:text-ink"}`} onClick={() => { onSeek(s.start); setEditingSeg(null); }} aria-label={`Seek to line ${i + 1}`}>{fmtTime(s.start)}</button>
                <span className="text-faint">→</span>
                <button className={`rounded px-1 ${live ? "bg-edit text-bg" : "text-muted hover:text-ink"}`} onClick={() => { onSeek(s.end); setEditingSeg(null); }} aria-label={`Seek to end of line ${i + 1}`}>{fmtTime(s.end)}</button>
                <span className="text-faint">·</span>
                <span className="text-muted">{Math.round((s.end - s.start) * 100) / 100}s</span>
                <button className="ml-auto rounded px-1.5 text-muted hover:text-ink" aria-expanded={expanded} onClick={() => (expanded ? finishEditSeg() : startEditSeg(i))}>{expanded ? "Close" : "Edit text"}</button>
                <button className="rounded px-1.5 text-faint hover:text-danger" onClick={() => { handleMerge(i); setEditingSeg(null); }} disabled={i >= segs.length - 1} title="Merge with next line">Merge</button>
                <button className="rounded px-1.5 text-faint hover:text-ink" onClick={() => { handleSplit(i); setEditingSeg(null); }} title="Split at playhead">Split</button>
                <button className="rounded px-1.5 text-faint hover:text-danger" onClick={() => { handleDelete(i); setEditingSeg(null); }} title="Delete line">Delete</button>
              </div>
              <textarea
                aria-label={`Line ${i + 1} text`}
                rows={2}
                className="field mt-1 h-auto resize-none px-2 py-1 text-[13px] font-medium"
                value={expanded ? segDraft : s.text}
                onChange={(e) => { setSegDraft(e.target.value.replace(/\s+/g, " ").trim()); if (expanded) handleSegTextChange(i, e); }}
                onFocus={() => { if (expanded) setSegDraft(s.text); }}
              />
              {expanded && (
                <div className="mt-2 flex flex-wrap gap-2 pt-2 border-t border-line/50 text-[11px]">
                  <span className="text-faint">Words (click a word to edit just it):</span>
                  {s.words.map((w, wi) => {
                    const wordActive = activeSegIdx === i && activeWordIdx === wi;
                    const wordEditing = editingWord?.segIdx === i && editingWord?.wordIdx === wi;
                    return (
                      <div key={wi} className="flex items-center gap-1.5">
                        <span className={`text-[10px] ${wordActive ? "text-system font-semibold" : "text-muted"}`}>{fmtTime(w.s)}</span>
                        <input
                          aria-label={`Word ${wi + 1} text`}
                          className={`field h-6 min-w-[40px] px-1 text-[12px] ${wordActive ? "bg-edit text-bg border-edit" : wordEditing ? "ring-1 ring-system" : "text-muted"}`}
                          value={wordEditing ? wordDraft : w.w}
                          onChange={(e) => { setWordDraft(e.target.value); handleWordText(i, wi, e); }}
                          onFocus={() => startEditWord(i, wi)}
                          onBlur={finishEditWord}
                          maxLength={40}
                          spellCheck={false}
                        />
                        <input
                          type="number"
                          step={0.05}
                          className="field h-6 w-[52px] px-1 text-[10px] tc"
                          value={w.s.toFixed(2)}
                          onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) handleWordTime(i, wi, "s", v); }}
                          title="Start"
                        />
                        <input
                          type="number"
                          step={0.05}
                          className="field h-6 w-[52px] px-1 text-[10px] tc"
                          value={w.e.toFixed(2)}
                          onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) handleWordTime(i, wi, "e", v); }}
                          title="End"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
