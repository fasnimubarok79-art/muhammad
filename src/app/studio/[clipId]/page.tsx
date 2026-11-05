"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/app/AppShell";
import { useSession } from "@/components/app/session";
import { AiPanel } from "@/components/studio/AiPanel";
import { CardPanel } from "@/components/studio/CardPanel";
import { ExportDialog } from "@/components/studio/ExportDialog";
import { InsertPanel } from "@/components/studio/InsertPanel";
import { ItemInspector } from "@/components/studio/ItemInspector";
import { MediaPanel, type AddTarget } from "@/components/studio/MediaPanel";
import { MultiTimeline } from "@/components/studio/MultiTimeline";
import { Inspector, SubtitleList, type FaceStatus } from "@/components/studio/Panels";
import { TimelinePlayer, type ClientTrack, type PlayerHandle } from "@/components/studio/TimelinePlayer";
import { defaultConfig, retime, useEditor, type Config, type Doc, type Seg } from "@/components/studio/useEditor";
import { ErrorNote, Spinner } from "@/components/ui/bits";
import { useToast } from "@/components/ui/use-toast";
import { api, fmtTime } from "@/lib/client";
import { cardSchema, type WordCard } from "@/lib/media/cards";
import { blankItem, CANVAS } from "@/lib/timeline/defaults";
import { mapCards, mapSegments, speechWindows, timelineToSrc } from "@/lib/timeline/mapping";
import { addItem, addMarker, cutRanges, duplicate, itemsOn, mainTrack, remove, split, timelineEnd } from "@/lib/timeline/ops";
import type { EffectType, Item, MediaInfo, TextConfig, TimelineDoc, TrackType } from "@/lib/timeline/schema";

type ClipResp = {
  clip: { faceTrack: ClientTrack | null; id: string; projectId: string; title: string; description: string | null; startSec: number; endSec: number; score: number | null; scoreReasons: Array<{ factor: string; score: number; note: string }> | null; editConfig: Partial<Config> | null; hasThumbnail: boolean; updatedAt: string };
  source: { id: string; durationSec: number; width: number | null; height: number | null; hasAudio: boolean | null };
  segments: Array<{ start: number; end: number; text: string; words: Seg["words"] }>;
  silences: Array<{ start: number; end: number }>; // clip-relative
  suggestions: { hashtags: string[] };
};
type TlResp = { timeline: TimelineDoc; version: number; media: MediaInfo[] };
type Layout = "desktop" | "tablet" | "mobile";

function useLayout(): Layout | null {
  const [l, setL] = useState<Layout | null>(null);
  useEffect(() => {
    const pick = () => setL(window.innerWidth >= 1280 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile");
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, []);
  return l;
}

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / pause"], ["S", "Split at the playhead (selected items, or the main video)"], ["Delete", "Delete selected"], ["Shift+Delete", "Ripple delete (close the gap)"],
  ["Ctrl+D", "Duplicate selected"], ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"], ["Ctrl+S", "Save now"], ["← / →", "One frame back / forward (Shift: 1 second)"],
  ["Home / End", "Start / end of the timeline"], ["M", "Add a marker"], ["Esc", "Clear the selection"], ["?", "This list"],
];

function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: Array<[T, string]>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="grid grid-cols-3 border-b border-line">
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`py-2 text-[12px] font-semibold ${value === k ? "border-b-2 border-edit text-ink" : "text-muted hover:text-ink"}`}>{l}</button>
      ))}
    </div>
  );
}

function Studio({ clipId }: { clipId: string }) {
  const toast = useToast();
  const { user, loading } = useSession();
  const search = useSearchParams();
  const [data, setData] = useState<ClipResp | null>(null);
  const [tl, setTl] = useState<TlResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<"media" | "text" | "subs" | "cards" | "effects" | "ai">("media");
  const [rightTab, setRightTab] = useState<"inspector" | "media" | "text" | "subs" | "cards" | "effects" | "ai">("inspector");
  const [mobileTab, setMobileTab] = useState<"clips" | "subs" | "cards">("clips");
  const [exporting, setExporting] = useState(search.get("panel") === "export");
  const [shortcuts, setShortcuts] = useState(false);
  const [known, setKnown] = useState<Map<string, MediaInfo>>(new Map());
  const player = useRef<PlayerHandle>(null);
  const lastT = useRef(0);
  const layout = useLayout();
  const [track, setTrack] = useState<ClientTrack | null>(null);
  const [face, setFace] = useState<FaceStatus>({ state: "none" });

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([api<ClipResp>(`/api/clips/${clipId}`), api<TlResp>(`/api/clips/${clipId}/timeline`)]);
      setData(r);
      setTl(t);
      setKnown((k) => new Map([...k, ...t.media.map((m) => [m.ref, m] as const)]));
      setError(null);
      api<{ peaks: number[] }>(`/api/clips/${clipId}/waveform`).then((w) => setPeaks(w.peaks), () => setPeaks([]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the clip");
    }
  }, [clipId]);
  useEffect(() => {
    if (!loading && user && !user.mustChangePassword) void load();
    if (!loading && !user) location.href = `/login?next=/studio/${clipId}`;
  }, [load, loading, user, clipId]);

  const clipLen = data ? data.clip.endSec - data.clip.startSec : 0;
  const initial: Doc | null = useMemo(() => {
    if (!data || !tl) return null;
    const base = defaultConfig(clipLen);
    const saved = data.clip.editConfig ?? {};
    const config: Config = { ...base, ...saved, style: { ...base.style, ...(saved.style ?? {}) } };
    config.trimEnd = Math.min(config.trimEnd || clipLen, clipLen);
    // drop malformed cards instead of failing the render later
    config.cards = (Array.isArray(saved.cards) ? saved.cards : []).flatMap((c) => { const r = cardSchema.safeParse(c); return r.success ? [r.data] : []; });
    return { title: data.clip.title, description: data.clip.description ?? "", segments: data.segments.map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words ?? [] })), config, timeline: tl.timeline };
  }, [data, tl, clipLen]);
  const ed = useEditor(clipId, initial, data?.clip.updatedAt ?? null, tl?.version ?? 1);
  const doc = ed.doc;

  useEffect(() => {
    const t = data?.clip.faceTrack;
    if (t && data && t.start <= data.clip.startSec + 0.01 && t.end >= data.clip.endSec - 0.01) {
      setTrack(t);
      setFace({ state: "ready", sampled: t.sampled, withFace: t.withFace });
    }
  }, [data]);
  const detectFaces = useCallback(async () => {
    setFace({ state: "detecting" });
    try {
      const r = await api<{ track: ClientTrack }>(`/api/clips/${clipId}/reframe`, { method: "POST" });
      setTrack(r.track);
      setFace({ state: "ready", sampled: r.track.sampled, withFace: r.track.withFace });
    } catch (e) {
      setFace({ state: "error", message: e instanceof Error ? e.message : "Face detection failed" });
    }
  }, [clipId]);
  useEffect(() => {
    if (ed.doc?.config.framing === "follow" && face.state === "none") void detectFaces();
  }, [ed.doc?.config.framing, face.state, detectFaces]);

  const onTime = useCallback((t: number) => {
    if (Math.abs(t - lastT.current) > 0.03) {
      lastT.current = t;
      setTime(t);
    }
  }, []);
  const seek = useCallback((t: number) => player.current?.seek(t), []);
  const setConfig = useCallback((c: Partial<Config>, group = false) => ed.commit((d) => {
    const config = { ...d.config, ...c };
    // the timeline canvas follows the export aspect
    const timeline = c.aspect && c.aspect !== d.config.aspect ? { ...d.timeline, width: CANVAS[c.aspect].w, height: CANVAS[c.aspect].h } : d.timeline;
    return { ...d, config, timeline };
  }, group), [ed]);
  const setDoc = useCallback((p: Partial<Doc>, group = false) => ed.commit((d) => ({ ...d, ...p }), group), [ed]);
  const setSegments = useCallback((segs: Seg[], group = false) => ed.commit((d) => ({ ...d, segments: segs }), group), [ed]);
  const setCards = useCallback((cards: WordCard[], group = false) => ed.commit((d) => ({ ...d, config: { ...d.config, cards } }), group), [ed]);
  const setTimeline = useCallback((t: TimelineDoc, group = false) => ed.commit((d) => ({ ...d, timeline: t }), group), [ed]);
  const onKnown = useCallback((infos: MediaInfo[]) => setKnown((k) => new Map([...k, ...infos.map((m) => [m.ref, m] as const)])), []);

  // ---------- derived ----------
  const timeline = doc?.timeline;
  const fps = timeline?.fps ?? 30;
  const sourceId = data?.source.id ?? "";
  const clipStart = data?.clip.startSec ?? 0;
  const mappedSegs = useMemo(() => (timeline && doc ? doc.segments.flatMap((s, idx) => mapSegments(timeline, sourceId, clipStart, [s]).map((m) => ({ ...m, idx }))) : []), [timeline, doc, sourceId, clipStart]);
  const mappedCards = useMemo(() => (timeline && doc ? mapCards(timeline, sourceId, clipStart, doc.config.cards ?? []) : []), [timeline, doc, sourceId, clipStart]);
  const clipTime = useMemo(() => {
    if (!timeline) return null;
    const src = timelineToSrc(timeline, sourceId, time);
    return src === null ? null : src - clipStart;
  }, [timeline, sourceId, time, clipStart]);
  const silenceRanges = useMemo(() => (data ? data.silences.filter((s) => s.end - s.start >= 0.6).map((s) => ({ start: clipStart + s.start + 0.12, end: clipStart + s.end - 0.12 })) : []), [data, clipStart]);
  const silenceSec = useMemo(() => {
    if (!timeline) return 0;
    const wins = speechWindows(timeline, sourceId);
    return silenceRanges.reduce((a, r) => a + wins.reduce((b, w) => b + Math.max(0, Math.min(r.end, w.srcB) - Math.max(r.start, w.srcA)), 0), 0);
  }, [timeline, sourceId, silenceRanges]);
  const limit = useCallback((it: Item) => {
    const m = known.get(it.mediaAssetId ? `asset:${it.mediaAssetId}` : `source:${it.sourceVideoId}`);
    return it.kind === "image" || it.kind === "text" || it.kind === "effect" || !m?.durationSec ? null : Math.floor(m.durationSec * fps);
  }, [known, fps]);

  // ---------- timeline actions ----------
  const frame = Math.round(time * fps);
  const doSplit = useCallback(() => {
    if (!timeline) return;
    const r = split(timeline, frame, selection.length ? selection : undefined);
    if (r) { setTimeline(r.doc); setSelection(r.created); } else toast({ tone: "info", title: selection.length ? "Put the playhead inside a selected item (on an unlocked track)" : "Put the playhead inside a main-track clip, or select items to split" });
  }, [timeline, frame, selection, setTimeline, toast]);
  const doDuplicate = useCallback(() => {
    if (!timeline || !selection.length) return;
    const r = duplicate(timeline, selection);
    if (r) { setTimeline(r.doc); setSelection(r.created); } else toast({ tone: "info", title: "Locked items cannot be duplicated" });
  }, [timeline, selection, setTimeline, toast]);
  const doDelete = useCallback((ripple: boolean) => {
    if (!timeline || !selection.length) return;
    const n = remove(timeline, selection, ripple);
    if (n) { setTimeline(n); setSelection([]); } else toast({ tone: "info", title: "Items on locked tracks cannot be deleted" });
  }, [timeline, selection, setTimeline, toast]);
  const doMarker = useCallback(() => { if (timeline) setTimeline(addMarker(timeline, frame).doc); }, [timeline, frame, setTimeline]);

  const place = useCallback((info: MediaInfo, trackId: string, at: number) => {
    if (!timeline) return;
    const tr = timeline.tracks.find((t) => t.id === trackId);
    if (!tr) return;
    const audioTrack = tr.type === "AUDIO";
    if (!["VIDEO", "BROLL", "OVERLAY", "AUDIO"].includes(tr.type)) return toast({ tone: "error", title: `Media cannot go on the ${tr.name} track` });
    if (!audioTrack && info.kind === "AUDIO") return toast({ tone: "error", title: "Audio goes on an audio track" });
    if (audioTrack && !info.hasAudio && info.kind !== "AUDIO") return toast({ tone: "error", title: "This file has no sound" });
    const kind: Item["kind"] = audioTrack ? "audio" : info.kind === "IMAGE" ? "image" : "video";
    const [refKind, id] = info.ref.split(":");
    const srcLen = info.durationSec ? Math.floor(info.durationSec * fps) : 3 * fps;
    const dur = info.kind === "IMAGE" ? 3 * fps : refKind === "source" ? Math.min(srcLen, 15 * fps) : srcLen;
    const it = blankItem(trackId, kind, Math.max(1, dur), refKind === "asset" ? { mediaAssetId: id } : { sourceVideoId: id });
    const isMain = trackId === mainTrack(timeline).id;
    if (!isMain && kind !== "audio" && it.transform) {
      it.transform = tr.type === "BROLL" ? { ...it.transform, fit: "cover" } : { ...it.transform, scale: 0.4 };
      it.volume = 0; // B-roll and overlays start silent; raise it in the inspector
    }
    const r = addItem(timeline, it, at);
    if (!r) return toast({ tone: "error", title: tr.locked ? "That track is locked" : "It does not fit there" });
    setKnown((k) => new Map(k).set(info.ref, info));
    setTimeline(r.doc);
    setSelection([r.id]);
  }, [timeline, fps, setTimeline, toast]);
  const addMedia = useCallback((info: MediaInfo, target: AddTarget) => {
    if (!timeline) return;
    const type: TrackType = target === "main" ? "VIDEO" : target === "broll" ? "BROLL" : target === "overlay" ? "OVERLAY" : "AUDIO";
    const tr = type === "VIDEO" ? mainTrack(timeline) : [...timeline.tracks].filter((t) => t.type === type && !t.locked).sort((a, b) => a.order - b.order)[0];
    if (!tr) return toast({ tone: "error", title: "Add an unlocked track of that type first" });
    place(info, tr.id, frame);
  }, [timeline, frame, place, toast]);
  const addText = useCallback((text: TextConfig, y: number) => {
    if (!timeline) return;
    const tr = timeline.tracks.find((t) => t.type === "TEXT" && !t.locked);
    if (!tr) return toast({ tone: "error", title: "Unlock or add a text track first" });
    const it = { ...blankItem(tr.id, "text", 2 * fps), text };
    if (it.transform) it.transform = { ...it.transform, y };
    const r = addItem(timeline, it, frame);
    if (r) { setTimeline(r.doc); setSelection([r.id]); }
  }, [timeline, fps, frame, setTimeline, toast]);
  const addEffect = useCallback((type: EffectType, sec: number) => {
    if (!timeline) return;
    const tr = timeline.tracks.find((t) => t.type === "EFFECTS" && !t.locked);
    if (!tr) return toast({ tone: "error", title: "Unlock or add an effects track first" });
    const r = addItem(timeline, { ...blankItem(tr.id, "effect", Math.max(1, Math.round(sec * fps))), effects: { fadeIn: 0, fadeOut: 0, type, intensity: 0.5 } }, frame);
    if (r) { setTimeline(r.doc); setSelection([r.id]); }
  }, [timeline, fps, frame, setTimeline, toast]);
  const cutSilences = useCallback(() => {
    if (!timeline) return;
    const n = cutRanges(timeline, mainTrack(timeline).id, { sourceVideoId: sourceId }, silenceRanges);
    if (n) { setTimeline(n); toast({ tone: "success", title: "Silences cut", body: "Undo brings them back." }); } else toast({ tone: "info", title: "No pauses left to cut on the main track (or it is locked)" });
  }, [timeline, sourceId, silenceRanges, setTimeline, toast]);
  const moveCard = useCallback((id: string, start: number, group: boolean) => {
    if (!timeline || !doc) return;
    const src = timelineToSrc(timeline, sourceId, Math.max(0, start));
    if (src === null) return;
    setCards(doc.config.cards.map((c) => (c.id === id ? { ...c, at: Number(Math.max(0, src - clipStart).toFixed(3)) } : c)), group);
  }, [timeline, doc, sourceId, clipStart, setCards]);
  const segEdge = useCallback((idx: number, edge: "start" | "end", tlT: number, group: boolean) => {
    if (!timeline || !doc) return;
    const src = timelineToSrc(timeline, sourceId, Math.max(0, tlT));
    if (src === null) return;
    const s = doc.segments[idx];
    const v = src - clipStart;
    const n = edge === "start" ? (v < s.end - 0.05 && v >= 0 ? retime(s, v, s.end) : null) : (v > s.start + 0.05 && v <= clipLen ? retime(s, s.start, v) : null);
    if (n) setSegments(doc.segments.map((x, k) => (k === idx ? n : x)), group);
  }, [timeline, doc, sourceId, clipStart, clipLen, setSegments]);
  const seekClip = useCallback((clipT: number) => {
    if (!timeline) return;
    const w = speechWindows(timeline, sourceId).find((x) => clipStart + clipT >= x.srcA && clipStart + clipT < x.srcB);
    if (w) seek(w.tlA + (clipStart + clipT - w.srcA) / w.speed);
    else toast({ tone: "info", title: "That moment is not on the timeline (it was cut or moved away)" });
  }, [timeline, sourceId, clipStart, seek, toast]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.code === "Space") { e.preventDefault(); player.current?.toggle(); }
      else if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); }
      else if (mod && k === "y") { e.preventDefault(); ed.redo(); }
      else if (mod && k === "s") { e.preventDefault(); void ed.saveNow(); }
      else if (mod && k === "d") { e.preventDefault(); doDuplicate(); }
      else if (!mod && k === "s") doSplit();
      else if (!mod && k === "m") doMarker();
      else if (e.key === "?") setShortcuts(true);
      else if ((e.key === "Delete" || e.key === "Backspace") && selection.length) { e.preventDefault(); doDelete(e.shiftKey); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && doc) { setSegments(doc.segments.filter((_, i) => i !== selected)); setSelected(null); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) seek(time - 1); else player.current?.step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) seek(time + 1); else player.current?.step(1); }
      else if (e.key === "Home") seek(0);
      else if (e.key === "End" && timeline) seek(timelineEnd(timeline) / fps);
      else if (e.key === "Escape") setSelection([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, time, selected, selection, ed, seek, setSegments, exporting, doSplit, doDuplicate, doDelete, doMarker, timeline, fps]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (ed.saveState === "dirty" || ed.saveState === "saving" || ed.saveState === "conflict") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ed.saveState]);

  if (error) return <div className="mx-auto max-w-xl p-8"><ErrorNote message={error} onRetry={load} /></div>;
  if (!data || !doc || !timeline || layout === null) return <div className="grid min-h-dvh place-items-center"><Spinner label="Opening studio" /></div>;

  const srcSize = data.source.width && data.source.height ? { w: data.source.width, h: data.source.height } : null;
  const saveLabel = { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving...", error: "Save failed, retrying", conflict: "Not saved: newer version elsewhere" }[ed.saveState];
  const length = timelineEnd(timeline) / fps;
  const selItem = selection.length === 1 ? timeline.items.find((i) => i.id === selection[0]) : undefined;
  const selTrack = selItem ? timeline.tracks.find((t) => t.id === selItem.trackId) : undefined;
  const mainItems = itemsOn(timeline, mainTrack(timeline).id);
  const mediaOf = (it: Item) => known.get(it.mediaAssetId ? `asset:${it.mediaAssetId}` : `source:${it.sourceVideoId}`);

  const playerEl = (
    <TimelinePlayer ref={player} doc={timeline} media={known} config={doc.config} segments={mappedSegs} cards={mappedCards} clipSourceId={sourceId} clipThumb={data.clip.hasThumbnail ? `/api/media/thumb/${clipId}` : null} track={track} onTime={onTime} />
  );
  const subsEl = <SubtitleList doc={doc} clipId={clipId} time={clipTime} clipLen={clipLen} selected={selected} onSelect={setSelected} onSegments={setSegments} onSeek={seekClip} onReplaced={load} />;
  const cardsEl = <CardPanel doc={doc} time={clipTime} clipLen={clipLen} onCards={setCards} onSeek={seekClip} />;
  const panel = (tab: string): ReactNode => {
    if (tab === "media") return <MediaPanel projectId={data.clip.projectId} onAdd={addMedia} onKnown={onKnown} />;
    if (tab === "text") return <InsertPanel kind="text" onText={addText} onEffect={addEffect} />;
    if (tab === "effects") return <InsertPanel kind="effects" onText={addText} onEffect={addEffect} />;
    if (tab === "subs") return subsEl;
    if (tab === "cards") return cardsEl;
    return (
      <AiPanel doc={doc} clipId={clipId} sourceId={data.source.id} score={data.clip.score} reasons={data.clip.scoreReasons ?? []} hashtags={data.suggestions.hashtags} srcSize={srcSize} onDoc={setDoc} onConfig={setConfig} onCaptionsRegenerated={load} onFollowFace={() => { setConfig({ framing: "follow" }); if (face.state !== "ready" && face.state !== "detecting") void detectFaces(); }} length={length} silenceSec={silenceSec} onCutSilences={cutSilences} />
    );
  };
  const itemInspector = selItem && selTrack ? <ItemInspector doc={timeline} item={selItem} track={selTrack} media={mediaOf(selItem)} time={time} onDoc={setTimeline} onSeek={seek} /> : null;
  const inspectorEl = (
    <>
      {itemInspector}
      {selection.length > 1 && <p className="border-b border-line px-3 py-3 text-[13px] text-muted">{selection.length} items selected. Move, duplicate or delete them together.</p>}
      <Inspector doc={doc} length={length} silenceSec={silenceSec} onConfig={setConfig} onDoc={setDoc} onCutSilences={cutSilences} face={face} onDetectFaces={detectFaces} />
    </>
  );
  const timelineEl = (
    <MultiTimeline
      doc={timeline} media={known} time={time} segments={mappedSegs} cards={mappedCards} selection={selection} selectedSeg={selected}
      onSelection={setSelection} onSelectSeg={setSelected} onSeek={seek} onDoc={setTimeline} onCardMove={moveCard} onSegEdge={segEdge}
      onDropMedia={(ref, trackId, f) => { const info = known.get(ref); if (info) place(info, trackId, f); }}
      onSplit={doSplit} onDuplicate={doDuplicate} onDelete={doDelete} onMarker={doMarker} limit={limit}
      waveform={peaks.length ? { sourceVideoId: sourceId, startSec: data.clip.startSec, endSec: data.clip.endSec, peaks } : undefined}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="hidden sm:inline-flex"><Wordmark /></span>
        <Link href={`/projects/${data.clip.projectId}`} className="btn-ghost h-8 shrink-0 whitespace-nowrap px-2 text-[12px]">← Project</Link>
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{doc.title}</p>
        <span className={`hidden text-[12px] sm:inline ${ed.saveState === "error" || ed.saveState === "conflict" ? "text-danger" : "text-muted"}`} role="status">{saveLabel}</span>
        <button className="btn-ghost h-8 px-2 text-[12px]" onClick={ed.undo} disabled={!ed.canUndo} aria-label="Undo">Undo</button>
        <button className="btn-ghost h-8 px-2 text-[12px]" onClick={ed.redo} disabled={!ed.canRedo} aria-label="Redo">Redo</button>
        <button className="btn-ghost hidden h-8 px-2 text-[12px] md:inline-flex" onClick={() => void ed.saveNow()}>Save</button>
        <button className="btn-ghost hidden h-8 px-2 text-[12px] md:inline-flex" onClick={() => player.current?.fullscreen()}>Preview</button>
        <button className="btn-ghost hidden h-8 w-8 px-0 text-[13px] md:inline-flex" onClick={() => setShortcuts(true)} aria-label="Keyboard shortcuts">?</button>
        <span className="hidden rounded-full border border-line px-2.5 py-0.5 text-[12px] tc lg:inline">{user?.unlimited ? "Unlimited" : `${user?.tokenBalance ?? 0} tokens`}</span>
        <button className="btn-primary h-8" onClick={() => setExporting(true)}>Export</button>
      </header>

      {ed.recovery && (
        <div className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-3 py-2 text-[13px]" role="alert">
          An unsaved draft from this browser is newer than the saved version.
          <button className="btn-secondary h-7 px-2 text-[12px]" onClick={ed.acceptRecovery}>Restore draft</button>
          <button className="btn-ghost h-7 px-2 text-[12px]" onClick={ed.dismissRecovery}>Discard</button>
        </div>
      )}
      {ed.saveState === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-danger/40 bg-danger/10 px-3 py-2 text-[13px]" role="alert">
          This timeline was saved from another tab or device after you opened it. Your changes are not saved yet.
          <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => void ed.keepMine()}>Keep my version</button>
          <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => void ed.loadTheirs()}>Load the saved version</button>
        </div>
      )}

      {layout === "mobile" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="h-[48vh] shrink-0">{playerEl}</div>
          <Tabs label="Edit" value={mobileTab} onChange={setMobileTab} tabs={[["clips", "Clips"], ["subs", "Subtitles"], ["cards", "Cards"]]} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {mobileTab === "subs" ? subsEl : mobileTab === "cards" ? cardsEl : (
              <div>
                <div className="flex flex-wrap gap-1.5 border-b border-line p-2">
                  <button className="btn-secondary h-9 px-3 text-[13px]" onClick={doSplit}>Split here</button>
                  <button className="btn-secondary h-9 px-3 text-[13px]" onClick={doDuplicate} disabled={!selection.length}>Duplicate</button>
                  <button className="btn-secondary h-9 px-3 text-[13px]" onClick={() => doDelete(true)} disabled={!selection.length}>Delete</button>
                  <button className="btn-secondary h-9 px-3 text-[13px]" onClick={cutSilences} disabled={silenceSec < 0.3}>Cut silences</button>
                </div>
                <p className="px-3 pt-2 text-[12px] text-muted">Tap a clip to select it. Delete closes the gap. The multi-track timeline needs a tablet or a computer.</p>
                <ol className="p-2">
                  {mainItems.map((it, i) => (
                    <li key={it.id}>
                      <button className={`mb-1.5 flex w-full items-center justify-between rounded-ctl border px-3 py-2.5 text-left text-[13px] ${selection.includes(it.id) ? "border-edit bg-edit/10" : "border-line bg-surface2"}`} onClick={() => { setSelection([it.id]); seek(it.startFrame / fps); }}>
                        <span>Clip {i + 1}</span>
                        <span className="text-muted tc">{fmtTime(it.startFrame / fps)} · {(it.durationFrames / fps).toFixed(1)}s</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {itemInspector}
              </div>
            )}
          </div>
        </div>
      )}

      {layout === "tablet" && (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "minmax(0,1fr) 320px", gridTemplateRows: "minmax(0,1fr) 340px" }}>
          <section aria-label="Preview" className="min-h-0 bg-bg">{playerEl}</section>
          <aside aria-label="Panels" className="flex min-h-0 flex-col border-l border-line bg-surface">
            <div role="tablist" aria-label="Panels" className="grid grid-cols-4 border-b border-line">
              {([["inspector", "Inspect"], ["media", "Media"], ["subs", "Subtitles"], ["cards", "Cards"], ["text", "Text"], ["effects", "Effects"], ["ai", "AI"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={rightTab === k} onClick={() => setRightTab(k)} className={`py-2 text-[12px] font-semibold ${rightTab === k ? "border-b-2 border-edit text-ink" : "text-muted"}`}>{l}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">{rightTab === "inspector" ? inspectorEl : panel(rightTab)}</div>
          </aside>
          <section aria-label="Timeline" className="col-span-2 min-h-0 border-t border-line bg-surface">{timelineEl}</section>
        </div>
      )}

      {layout === "desktop" && (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "300px minmax(0,1fr) 320px", gridTemplateRows: "minmax(0,1fr) 300px" }}>
          <aside aria-label="Library and tools" className="flex min-h-0 flex-col border-r border-line bg-surface">
            <Tabs label="Left panel" value={leftTab} onChange={setLeftTab} tabs={[["media", "Media"], ["text", "Text"], ["effects", "Effects"], ["subs", "Subtitles"], ["cards", "Cards"], ["ai", "AI Editor Pro"]]} />
            <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">{panel(leftTab)}</div>
          </aside>
          <section aria-label="Preview" className="min-h-0 bg-bg">{playerEl}</section>
          <aside aria-label="Properties" className="row-span-2 min-h-0 overflow-y-auto border-l border-line bg-surface">{inspectorEl}</aside>
          <section aria-label="Timeline" className="col-span-2 min-h-0 border-t border-line bg-surface">{timelineEl}</section>
        </div>
      )}

      {shortcuts && (
        <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShortcuts(false)}>
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center"><h2 className="flex-1 text-[16px] font-bold">Keyboard shortcuts</h2><button className="btn-ghost h-8 px-2 text-[12px]" onClick={() => setShortcuts(false)} autoFocus>Close</button></div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              {SHORTCUTS.map(([k, v]) => <div key={k} className="contents"><dt><kbd className="rounded border border-line bg-surface2 px-1.5 py-0.5 text-[12px] tc">{k}</kbd></dt><dd className="text-muted">{v}</dd></div>)}
            </dl>
          </div>
        </div>
      )}
      {exporting && <ExportDialog clipId={clipId} config={doc.config} summary={`${length.toFixed(1)}s timeline · ${timeline.items.length} items on ${new Set(timeline.items.map((i) => i.trackId)).size} tracks`} onClose={() => setExporting(false)} beforeRender={async () => ed.saveNow()} />}
    </div>
  );
}

export default function Page({ params }: { params: { clipId: string } }) {
  return <Suspense><Studio clipId={params.clipId} /></Suspense>;
}
