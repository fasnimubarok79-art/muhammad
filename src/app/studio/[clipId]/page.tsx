"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "@/components/app/AppShell";
import { useSession } from "@/components/app/session";
import { AiPanel } from "@/components/studio/AiPanel";
import { ExportDialog } from "@/components/studio/ExportDialog";
import { Inspector, SubtitleList } from "@/components/studio/Panels";
import { Player, type PlayerHandle } from "@/components/studio/Player";
import { Timeline } from "@/components/studio/Timeline";
import { defaultConfig, splitAt, useEditor, type Config, type Doc, type Seg } from "@/components/studio/useEditor";
import { ErrorNote, Spinner } from "@/components/ui/bits";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/client";
import { useMedia } from "@/hooks/useMedia";

type ClipResp = {
  clip: { id: string; projectId: string; title: string; description: string | null; startSec: number; endSec: number; score: number | null; scoreReasons: Array<{ factor: string; score: number; note: string }> | null; editConfig: Partial<Config> | null; hasThumbnail: boolean; updatedAt: string };
  source: { id: string; durationSec: number; width: number | null; height: number | null; hasAudio: boolean | null };
  segments: Array<{ start: number; end: number; text: string; words: Seg["words"] }>;
  silences: Array<{ start: number; end: number }>;
  suggestions: { hashtags: string[] };
};

function Studio({ clipId }: { clipId: string }) {
  const toast = useToast();
  const { user, loading } = useSession();
  const search = useSearchParams();
  const [data, setData] = useState<ClipResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [leftTab, setLeftTab] = useState<"subs" | "ai">("subs");
  const [exporting, setExporting] = useState(search.get("panel") === "export");
  const player = useRef<PlayerHandle>(null);
  const lastT = useRef(0);
  const wide = useMedia("(min-width: 1024px)");

  const load = useCallback(async () => {
    try {
      const r = await api<ClipResp>(`/api/clips/${clipId}`);
      setData(r);
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
    if (!data) return null;
    const base = defaultConfig(clipLen);
    const saved = data.clip.editConfig ?? {};
    const config: Config = { ...base, ...saved, style: { ...base.style, ...(saved.style ?? {}) } };
    config.trimEnd = Math.min(config.trimEnd || clipLen, clipLen);
    return { title: data.clip.title, description: data.clip.description ?? "", segments: data.segments.map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words ?? [] })), config };
  }, [data, clipLen]);
  const ed = useEditor(clipId, initial, data?.clip.updatedAt ?? null);
  const doc = ed.doc;

  const onTime = useCallback((t: number) => {
    if (Math.abs(t - lastT.current) > 0.03) {
      lastT.current = t;
      setTime(t);
    }
  }, []);
  const seek = useCallback((t: number) => player.current?.seek(t), []);
  const setConfig = useCallback((c: Partial<Config>, group = false) => ed.commit((d) => ({ ...d, config: { ...d.config, ...c } }), group), [ed]);
  const setDoc = useCallback((p: Partial<Doc>, group = false) => ed.commit((d) => ({ ...d, ...p }), group), [ed]);
  const setSegments = useCallback((segs: Seg[], group = false) => ed.commit((d) => ({ ...d, segments: segs }), group), [ed]);

  // keyboard: Space play/pause, S split, Delete remove line, Ctrl+Z / Ctrl+Shift+Z, arrows nudge
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") { e.preventDefault(); player.current?.toggle(); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); ed.redo(); }
      else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void ed.saveNow(); }
      else if (e.key.toLowerCase() === "s" && doc) {
        const n = splitAt(doc.segments, time);
        if (n) setSegments(n); else toast({ tone: "info", title: "Put the playhead inside a subtitle line with at least two words to split it" });
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && doc) {
        setSegments(doc.segments.filter((_, i) => i !== selected));
        setSelected(null);
      } else if (e.key === "ArrowLeft") seek(time - (e.shiftKey ? 1 : 0.1));
      else if (e.key === "ArrowRight") seek(time + (e.shiftKey ? 1 : 0.1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, time, selected, ed, seek, setSegments, exporting, toast]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (ed.saveState === "dirty" || ed.saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ed.saveState]);

  if (error) return <div className="mx-auto max-w-xl p-8"><ErrorNote message={error} onRetry={load} /></div>;
  if (!data || !doc || wide === null) return <div className="grid min-h-dvh place-items-center"><Spinner label="Opening studio" /></div>;

  const srcSize = data.source.width && data.source.height ? { w: data.source.width, h: data.source.height } : null;
  const saveLabel = { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving...", error: "Save failed, retrying on next change" }[ed.saveState];

  const playerEl = (
    <Player ref={player} sourceId={data.source.id} clipId={clipId} hasThumb={data.clip.hasThumbnail} clipStart={data.clip.startSec} clipLen={clipLen} config={doc.config} segments={doc.segments} srcSize={srcSize} onTime={onTime} />
  );
  const subsEl = (
    <SubtitleList doc={doc} clipId={clipId} time={time} selected={selected} onSelect={setSelected} onSegments={setSegments} onSeek={seek} onReplaced={load} />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
        <Wordmark />
        <Link href={`/projects/${data.clip.projectId}`} className="btn-ghost h-8 px-2 text-[12px]">← Project</Link>
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{doc.title}</p>
        <span className={`hidden text-[12px] sm:inline ${ed.saveState === "error" ? "text-danger" : "text-muted"}`} role="status">{saveLabel}</span>
        <button className="btn-ghost h-8 px-2 text-[12px]" onClick={ed.undo} disabled={!ed.canUndo} aria-label="Undo">Undo</button>
        <button className="btn-ghost h-8 px-2 text-[12px]" onClick={ed.redo} disabled={!ed.canRedo} aria-label="Redo">Redo</button>
        <span className="hidden rounded-full border border-line px-2.5 py-0.5 text-[12px] tc md:inline">{user?.unlimited ? "Unlimited" : `${user?.tokenBalance ?? 0} tokens`}</span>
        <button className="btn-primary h-8" onClick={() => setExporting(true)}>Export</button>
      </header>

      {ed.recovery && (
        <div className="flex items-center gap-3 border-b border-warn/40 bg-warn/10 px-3 py-2 text-[13px]" role="alert">
          An unsaved draft from this browser is newer than the saved version.
          <button className="btn-secondary h-7 px-2 text-[12px]" onClick={ed.acceptRecovery}>Restore draft</button>
          <button className="btn-ghost h-7 px-2 text-[12px]" onClick={ed.dismissRecovery}>Discard</button>
        </div>
      )}

      {/* narrow screens: preview and text editing only (one layout is mounted, so only one <video> loads) */}
      {!wide && (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">The editing timeline needs a screen at least 1024px wide. You can preview, edit subtitle text and export here.</p>
        <div className="h-[55vh] shrink-0">{playerEl}</div>
        <div className="min-h-0 flex-1 border-t border-line">{subsEl}</div>
      </div>
      )}

      {wide && (
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "280px minmax(0,1fr) 320px", gridTemplateRows: "minmax(0,1fr) 240px" }}>
        <aside className="row-span-1 flex min-h-0 flex-col border-r border-line bg-surface">
          <div role="tablist" aria-label="Left panel" className="flex border-b border-line">
            {([["subs", "Subtitles"], ["ai", "AI Editor Pro"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={leftTab === k} onClick={() => setLeftTab(k)} className={`flex-1 py-2 text-[12px] font-semibold ${leftTab === k ? "border-b-2 border-edit text-ink" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
            {leftTab === "subs" ? subsEl : (
              <AiPanel doc={doc} clipId={clipId} sourceId={data.source.id} score={data.clip.score} reasons={data.clip.scoreReasons ?? []} hashtags={data.suggestions.hashtags} silences={data.silences} srcSize={srcSize} onDoc={setDoc} onConfig={setConfig} onCaptionsRegenerated={load} />
            )}
          </div>
        </aside>
        <section aria-label="Preview" className="min-h-0 bg-bg">{playerEl}</section>
        <aside aria-label="Properties" className="row-span-2 min-h-0 overflow-y-auto border-l border-line bg-surface">
          <Inspector doc={doc} clipLen={clipLen} onConfig={setConfig} onDoc={setDoc} />
        </aside>
        <section aria-label="Timeline" className="col-span-2 min-h-0 border-t border-line bg-surface">
          <Timeline
            clipLen={clipLen}
            time={time}
            segments={doc.segments}
            config={doc.config}
            silences={data.silences}
            peaks={peaks}
            selected={selected}
            onSelect={setSelected}
            onSeek={seek}
            onSegments={(s, g) => setSegments(s, g)}
            onTrim={(a, b, g) => setConfig({ trimStart: Number(a.toFixed(3)), trimEnd: Number(b.toFixed(3)) }, g)}
          />
        </section>
      </div>
      )}

      {exporting && <ExportDialog clipId={clipId} config={doc.config} onClose={() => setExporting(false)} beforeRender={async () => ed.saveNow()} />}
    </div>
  );
}

export default function Page({ params }: { params: { clipId: string } }) {
  return <Suspense><Studio clipId={params.clipId} /></Suspense>;
}
