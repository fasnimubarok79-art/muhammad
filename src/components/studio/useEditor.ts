"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { WordCard } from "@/lib/media/cards";

export type Word = { w: string; s: number; e: number; p?: number };
export type Seg = { start: number; end: number; text: string; words: Word[] };
export type Style = { preset: "karaoke" | "clean" | "pop" | "impact" | "punch"; fontSize: number; primary: string; highlight: string; outline: number; shadow: number; marginV: number };
export type Config = {
  preset: "cinematic_punch" | "cinematic_podcast" | "viral_short" | "viral_spotlight" | "educational" | "storytelling" | "clean_professional";
  aspect: "9:16" | "16:9" | "1:1";
  resolution: "450p" | "720p" | "1080p";
  framing: "blur" | "crop" | "pad" | "follow";
  cropX: number;
  removeSilence: boolean;
  burnSubtitles: boolean;
  trimStart: number;
  trimEnd: number;
  style: Style;
  cards: WordCard[];
};
export type Doc = { title: string; description: string; segments: Seg[]; config: Config };

export const DEFAULT_STYLE: Style = { preset: "karaoke", fontSize: 84, primary: "#FFFFFF", highlight: "#FF7A1A", outline: 7, shadow: 3, marginV: 540 };
export const defaultConfig = (len: number): Config => ({
  preset: "viral_short", aspect: "9:16", resolution: "1080p", framing: "blur", cropX: 0.5, removeSilence: false, burnSubtitles: true, trimStart: 0, trimEnd: len, style: DEFAULT_STYLE, cards: [],
});

const LIMIT = 50;

/** Editor document with 50-step undo/redo, localStorage autosave (400ms) and debounced server save. */
export function useEditor(clipId: string, initial: Doc | null, serverUpdatedAt: string | null) {
  const [doc, setDoc] = useState<Doc | null>(initial);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const [, force] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [recovery, setRecovery] = useState<Doc | null>(null);
  const lastSaved = useRef<string>("");
  const draftKey = `clipkita:draft:${clipId}`;

  useEffect(() => {
    if (!initial) return;
    setDoc(initial);
    lastSaved.current = JSON.stringify(initial);
    past.current = [];
    future.current = [];
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { savedAt: string; doc: Doc };
        if (serverUpdatedAt && d.savedAt > serverUpdatedAt && JSON.stringify(d.doc) !== lastSaved.current) setRecovery(d.doc);
      }
    } catch {}
  }, [initial, draftKey, serverUpdatedAt]);

  const commit = useCallback((next: Doc | ((d: Doc) => Doc), group = false) => {
    setDoc((cur) => {
      if (!cur) return cur;
      const n = typeof next === "function" ? next(cur) : next;
      if (!group || past.current.length === 0) {
        past.current = [...past.current.slice(-(LIMIT - 1)), cur];
      }
      future.current = [];
      return n;
    });
    setSaveState("dirty");
  }, []);

  const undo = useCallback(() => {
    setDoc((cur) => {
      const prev = past.current.pop();
      if (!cur || !prev) return cur;
      future.current = [...future.current, cur].slice(-LIMIT);
      return prev;
    });
    setSaveState("dirty");
    force((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    setDoc((cur) => {
      const nxt = future.current.pop();
      if (!cur || !nxt) return cur;
      past.current = [...past.current, cur].slice(-LIMIT);
      return nxt;
    });
    setSaveState("dirty");
    force((x) => x + 1);
  }, []);

  // local autosave (400ms) for crash recovery
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ savedAt: new Date().toISOString(), doc }));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [doc, draftKey]);

  const saveNow = useCallback(async (d: Doc) => {
    const snapshot = JSON.stringify(d);
    if (snapshot === lastSaved.current) return setSaveState("saved");
    setSaveState("saving");
    try {
      const prev = lastSaved.current ? (JSON.parse(lastSaved.current) as Doc) : null;
      if (!prev || JSON.stringify(prev.segments) !== JSON.stringify(d.segments)) {
        await api(`/api/clips/${clipId}/subtitles`, { method: "PUT", body: { segments: d.segments } });
      }
      await api(`/api/clips/${clipId}`, { method: "PATCH", body: { title: d.title, description: d.description, editConfig: d.config } });
      lastSaved.current = snapshot;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [clipId]);

  // server autosave, debounced
  useEffect(() => {
    if (!doc || saveState !== "dirty") return;
    const t = setTimeout(() => void saveNow(doc), 1500);
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
    saveNow: () => doc && saveNow(doc),
    recovery,
    acceptRecovery: () => {
      if (recovery) commit(recovery);
      setRecovery(null);
    },
    dismissRecovery: () => setRecovery(null),
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

/** Split a segment at time t (clip-relative) on the nearest word boundary. */
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
