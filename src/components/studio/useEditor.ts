"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ClientApiError } from "@/lib/client";
import type { WordCard } from "@/lib/media/cards";
import type { TimelineDoc } from "@/lib/timeline/schema";

export type Word = { w: string; s: number; e: number; p?: number };
export type Seg = { start: number; end: number; text: string; words: Word[] };
export type Style = { preset: "karaoke" | "clean" | "pop" | "impact" | "punch" | "hormozi"; fontSize: number; primary: string; highlight: string; outline: number; shadow: number; marginV: number; popScale: number };
export type Config = {
  preset: "cinematic_punch" | "cinematic_podcast" | "viral_short" | "viral_spotlight" | "educational" | "storytelling" | "clean_professional";
  aspect: "9:16" | "16:9" | "1:1";
  resolution: "450p" | "720p" | "1080p";
  framing: "blur" | "crop" | "pad" | "follow";
  cropX: number;
  removeSilence: boolean; // legacy: only used to build the first timeline of an old clip
  burnSubtitles: boolean;
  trimStart: number; // legacy, as above
  trimEnd: number;
  style: Style;
  cards: WordCard[];
  bgColor?: string; // fill colour for empty areas in Fit+blur / Bars framing
  watermark?: { input: number; x: number; y: number; scale: number; opacity: number }; // overlay drawn over the render
};
export type Doc = { title: string; description: string; segments: Seg[]; config: Config; timeline: TimelineDoc };
export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export const DEFAULT_STYLE: Style = { preset: "karaoke", fontSize: 84, primary: "#FFFFFF", highlight: "#FF7A1A", outline: 7, shadow: 3, marginV: 540, popScale: 1.0 };
export const defaultConfig = (len: number): Config => ({
  preset: "viral_short", aspect: "9:16", resolution: "1080p", framing: "blur", cropX: 0.5, removeSilence: false, burnSubtitles: true, trimStart: 0, trimEnd: len, style: DEFAULT_STYLE, cards: [], bgColor: "#000000", watermark: undefined,
});

const LIMIT = 50;

/**
 * Editor document with 50-step undo/redo (snapshots of the whole document, timeline included),
 * a localStorage draft every 400 ms for crash recovery, and a debounced server save.
 * Saves never overlap: a change made while a save is running is sent right after it. A save only
 * counts as saved when the server confirmed it; a stale timeline version shows a conflict.
 */
export function useEditor(clipId: string, initial: Doc | null, serverUpdatedAt: string | null, initialVersion: number) {
  const [doc, setDoc] = useState<Doc | null>(initial);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const [, force] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [recovery, setRecovery] = useState<Doc | null>(null);
  const lastSaved = useRef<string>("");
  const version = useRef(initialVersion);
  const inflight = useRef(false);
  const queued = useRef<Doc | null>(null);
  const conflict = useRef<number | null>(null);
  const draftKey = `clipkita:draft:${clipId}`;

  useEffect(() => {
    if (!initial) return;
    setDoc(initial);
    lastSaved.current = JSON.stringify(initial);
    version.current = initialVersion;
    past.current = [];
    future.current = [];
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { savedAt: string; doc: Doc };
        if (serverUpdatedAt && d.savedAt > serverUpdatedAt && d.doc?.timeline && JSON.stringify(d.doc) !== lastSaved.current) setRecovery(d.doc);
      }
    } catch {}
  }, [initial, draftKey, serverUpdatedAt, initialVersion]);

  const commit = useCallback((next: Doc | ((d: Doc) => Doc), group = false) => {
    setDoc((cur) => {
      if (!cur) return cur;
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      if (!group || past.current.length === 0) past.current = [...past.current.slice(-(LIMIT - 1)), cur];
      future.current = [];
      return n;
    });
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
  }, []);

  const undo = useCallback(() => {
    setDoc((cur) => {
      const prev = past.current.pop();
      if (!cur || !prev) return cur;
      future.current = [...future.current, cur].slice(-LIMIT);
      return prev;
    });
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
    force((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    setDoc((cur) => {
      const nxt = future.current.pop();
      if (!cur || !nxt) return cur;
      past.current = [...past.current, cur].slice(-LIMIT);
      return nxt;
    });
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
    force((x) => x + 1);
  }, []);

  // local draft (400 ms) for crash recovery
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ savedAt: new Date().toISOString(), doc }));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [doc, draftKey]);

  const saveNow = useCallback(async (d: Doc): Promise<void> => {
    if (inflight.current) {
      queued.current = d;
      return;
    }
    const snapshot = JSON.stringify(d);
    if (snapshot === lastSaved.current) {
      setSaveState((s) => (s === "conflict" ? s : "saved"));
      return;
    }
    inflight.current = true;
    setSaveState("saving");
    try {
      const prev = lastSaved.current ? (JSON.parse(lastSaved.current) as Doc) : null;
      if (!prev || JSON.stringify(prev.segments) !== JSON.stringify(d.segments)) {
        await api(`/api/clips/${clipId}/subtitles`, { method: "PUT", body: { segments: d.segments } });
      }
      if (!prev || JSON.stringify(prev.timeline) !== JSON.stringify(d.timeline)) {
        const r = await api<{ version: number }>(`/api/clips/${clipId}/timeline`, { method: "PUT", body: { version: version.current, timeline: d.timeline } });
        version.current = r.version;
      }
      await api(`/api/clips/${clipId}`, { method: "PATCH", body: { title: d.title, description: d.description, editConfig: d.config } });
      lastSaved.current = snapshot;
      conflict.current = null;
      setSaveState("saved");
    } catch (e) {
      if (e instanceof ClientApiError && e.body.code === "VERSION_CONFLICT") {
        conflict.current = typeof e.body.version === "number" ? e.body.version : null;
        queued.current = null;
        setSaveState("conflict");
      } else setSaveState("error");
    } finally {
      inflight.current = false;
    }
    const next = queued.current;
    queued.current = null;
    if (next && conflict.current === null) await saveNow(next);
  }, [clipId]);

  // server autosave, debounced; failed saves retry on the next change or after 10 s
  useEffect(() => {
    if (!doc || (saveState !== "dirty" && saveState !== "error")) return;
    const t = setTimeout(() => void saveNow(doc), saveState === "error" ? 10_000 : 1500);
    return () => clearTimeout(t);
  }, [doc, saveState, saveNow]);

  return {
    doc,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveState,
    saveNow: () => (doc ? saveNow(doc) : Promise.resolve()),
    recovery,
    acceptRecovery: () => {
      if (recovery) commit(recovery);
      setRecovery(null);
    },
    dismissRecovery: () => setRecovery(null),
    /** Conflict: keep this tab's version and overwrite the newer saved one. */
    keepMine: async () => {
      const r = await api<{ version: number }>(`/api/clips/${clipId}/timeline`);
      version.current = r.version;
      conflict.current = null;
      setSaveState("dirty");
    },
    /** Conflict: load the saved timeline (this replaces the local timeline, it is not undoable). */
    loadTheirs: async () => {
      const r = await api<{ version: number; timeline: TimelineDoc }>(`/api/clips/${clipId}/timeline`);
      version.current = r.version;
      conflict.current = null;
      setDoc((cur) => {
        if (!cur) return cur;
        const n = { ...cur, timeline: r.timeline };
        lastSaved.current = JSON.stringify({ ...JSON.parse(lastSaved.current || "{}"), timeline: r.timeline });
        return n;
      });
      past.current = [];
      future.current = [];
      setSaveState("dirty");
    },
    replaceSegmentsFromServer: (segs: Seg[]) => {
      setDoc((cur) => {
        if (!cur) return cur;
        past.current = [...past.current.slice(-(LIMIT - 1)), cur];
        const n = { ...cur, segments: segs };
        lastSaved.current = JSON.stringify({ ...JSON.parse(lastSaved.current || "{}"), segments: segs });
        return n;
      });
    },
  };
}

/** Split a subtitle line at clip time t on the nearest word boundary. */
export function splitAt(segs: Seg[], t: number): Seg[] | null {
  const i = segs.findIndex((s) => t > s.start && t < s.end);
  if (i < 0) return null;
  const s = segs[i];
  let k = s.words.findIndex((w) => w.s >= t);
  if (k <= 0) k = Math.max(1, Math.round(s.words.length / 2));
  if (k >= s.words.length) return null;
  const a = s.words.slice(0, k);
  const b = s.words.slice(k);
  const left = { start: s.start, end: a[a.length - 1].e, text: a.map((w) => w.w).join(" "), words: a };
  const right = { start: b[0].s, end: s.end, text: b.map((w) => w.w).join(" "), words: b };
  return [...segs.slice(0, i), left, right, ...segs.slice(i + 1)];
}

/** Re-time words evenly when the text of a segment is edited by hand. */
export function retext(seg: Seg, text: string): Seg {
  const parts = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === seg.words.length && parts.every((p, i) => p === seg.words[i].w)) return { ...seg, text };
  if (parts.length === seg.words.length) return { ...seg, text, words: seg.words.map((w, i) => ({ ...w, w: parts[i] })) };
  const step = (seg.end - seg.start) / Math.max(1, parts.length);
  return { ...seg, text, words: parts.map((w, i) => ({ w, s: seg.start + i * step, e: seg.start + (i + 1) * step, p: -1 })) };
}

export function retime(seg: Seg, start: number, end: number): Seg {
  const scale = (end - start) / Math.max(0.05, seg.end - seg.start);
  return { ...seg, start, end, words: seg.words.map((w) => ({ ...w, s: start + (w.s - seg.start) * scale, e: start + (w.e - seg.start) * scale })) };
}
