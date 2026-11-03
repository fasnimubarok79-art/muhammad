"use client";

import { useMemo, useState, type ReactNode } from "react";
import { api, ClientApiError } from "@/lib/client";
import { useToast } from "../ui/use-toast";
import { PRESET_INFO } from "./Panels";
import type { Config, Doc, Seg } from "./useEditor";

type Reason = { factor: string; score: number; note: string };
type Props = {
  doc: Doc;
  clipId: string;
  sourceId: string;
  score: number | null;
  reasons: Reason[];
  hashtags: string[];
  silences: Array<{ start: number; end: number }>;
  srcSize: { w: number; h: number } | null;
  onDoc: (d: Partial<Doc>) => void;
  onConfig: (c: Partial<Config>) => void;
  onCaptionsRegenerated: () => void;
  onFollowFace: () => void;
};

const FACTOR: Record<string, string> = {
  hook: "Smart Hook", speech_density: "Pacing", low_dead_air: "Dead air", complete_thought: "Complete thought", length_fit: "Length", topic_relevance: "Highlight / topic", emphasis: "Emphasis",
};

function Tool({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-sans text-[13px] font-semibold" style={{ fontStretch: "100%" }}>{title}</h3>
        {tag && <span className="rounded-full border border-line px-2 text-[10px] text-muted">{tag}</span>}
      </div>
      <div className="text-[12px] text-muted">{children}</div>
    </section>
  );
}

/** A suggestion the user can preview, accept, reject, edit, or ask again for. */
function Suggestion({ items, apply, label }: { items: string[]; apply: (v: string) => void; label: string }) {
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  if (!items.length) return <p>No suggestion: the transcript for this clip is empty.</p>;
  if (hidden) return <button className="btn-ghost h-7 px-0 text-[12px]" onClick={() => setHidden(false)}>Show suggestion again</button>;
  const value = edit ?? items[i % items.length];
  return (
    <div className="rounded-ctl border border-line bg-surface2 p-2">
      {edit !== null ? (
        <textarea aria-label={`Edit ${label}`} className="field h-16 py-1 text-[13px]" value={edit} onChange={(e) => setEdit(e.target.value)} />
      ) : (
        <p className="text-[13px] text-ink">{value}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <button className="btn-primary h-7 px-2 text-[12px]" onClick={() => { apply(value); setEdit(null); }}>Accept</button>
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => setEdit(edit === null ? value : null)}>{edit === null ? "Edit" : "Cancel edit"}</button>
        <button className="btn-secondary h-7 px-2 text-[12px]" disabled={items.length < 2} onClick={() => { setI((x) => x + 1); setEdit(null); }}>Another</button>
        <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => setHidden(true)}>Reject</button>
      </div>
    </div>
  );
}

const sentencesOf = (segs: Seg[]) =>
  segs
    .map((s) => s.text)
    .join(" ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

export function AiPanel({ doc, clipId, sourceId, score, reasons, hashtags, silences, srcSize, onDoc, onConfig, onCaptionsRegenerated, onFollowFace }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const sents = useMemo(() => sentencesOf(doc.segments), [doc.segments]);
  const titles = useMemo(() => Array.from(new Set(sents.map((s) => (s.length > 70 ? s.slice(0, 67).trimEnd() + "..." : s)))).slice(0, 5), [sents]);
  const captions = useMemo(() => {
    const tags = hashtags.join(" ");
    const out: string[] = [];
    if (sents.length) out.push(`${sents.slice(0, 2).join(" ")}${tags ? `\n\n${tags}` : ""}`);
    if (sents.length > 2) out.push(`${sents[sents.length - 1]}${tags ? `\n\n${tags}` : ""}`);
    return out;
  }, [sents, hashtags]);
  const removable = silences.filter((s) => s.end - s.start >= 0.6).reduce((a, s) => a + Math.max(0, s.end - s.start - 0.24), 0);
  const landscape = srcSize ? srcSize.w > srcSize.h : false;
  const len = doc.config.trimEnd - doc.config.trimStart;
  const smart: Partial<Config> = {
    aspect: "9:16",
    resolution: "1080p",
    framing: landscape ? "follow" : "crop",
    preset: len > 45 ? "educational" : "viral_short",
    removeSilence: removable > 1,
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ tone: "error", title: "That did not work", body: e instanceof ClientApiError ? e.body.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="border-b border-line px-3 py-2 text-[11px] text-faint">Suggestions come from this clip&apos;s real transcript and audio analysis. Nothing is generated without source data.</p>

      <Tool title="Viral Potential Analyzer" tag="estimate">
        {score == null ? <p>No score yet.</p> : (
          <>
            <p className="mb-2"><span className="font-display text-[24px] font-extrabold text-ink tc">{Math.round(score)}</span> / 100. An estimate from the signals below, not a promise of views.</p>
            <ul className="flex flex-col gap-1.5">
              {reasons.map((r) => (
                <li key={r.factor}>
                  <div className="flex justify-between text-[12px]"><span className="text-ink">{FACTOR[r.factor] ?? r.factor}</span><span className="tc">{Math.round(r.score * 100)}</span></div>
                  <div className="mt-0.5 h-1 rounded-full bg-surface2"><div className="h-full rounded-full bg-system" style={{ width: `${r.score * 100}%` }} /></div>
                  <p className="mt-0.5 text-[11px] text-faint">{r.note}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Tool>

      <Tool title="AI Title" tag="from transcript">
        <Suggestion label="title" items={titles} apply={(v) => { onDoc({ title: v.slice(0, 140) }); toast({ tone: "success", title: "Title updated" }); }} />
      </Tool>

      <Tool title="Caption Generator + Hashtags" tag="from transcript">
        <Suggestion label="caption" items={captions} apply={(v) => { onDoc({ description: v.slice(0, 2000) }); toast({ tone: "success", title: "Caption saved to description" }); }} />
        {hashtags.length > 0 && <p className="mt-2">Hashtags from recurring words: <span className="text-ink">{hashtags.join(" ")}</span></p>}
      </Tool>

      <Tool title="Auto Caption">
        <p className="mb-2">Rebuild the subtitle lines from the Whisper transcript. This replaces manual edits (you can undo).</p>
        <button className="btn-secondary h-8 text-[12px]" disabled={busy === "cap"} onClick={() => run("cap", async () => { await api(`/api/clips/${clipId}/subtitles`, { method: "POST" }); onCaptionsRegenerated(); toast({ tone: "success", title: "Subtitles rebuilt from the transcript" }); })}>
          {busy === "cap" ? "Rebuilding..." : "Reprocess captions"}
        </button>
      </Tool>

      <Tool title="Silence Removal">
        <p className="mb-2">About {removable.toFixed(1)}s of pauses longer than 0.6s were detected in this clip.</p>
        <label className="flex items-center gap-2 text-ink"><input type="checkbox" className="accent-[#3DDC97]" checked={doc.config.removeSilence} onChange={(e) => onConfig({ removeSilence: e.target.checked })} /> Cut them in the render</label>
      </Tool>

      <Tool title="Smart Reframe" tag="face tracking">
        <p className="mb-2">Source is {srcSize ? `${srcSize.w}×${srcSize.h} (${landscape ? "landscape" : "portrait"})` : "unknown"}. Follow face detects faces with OpenCV and moves the crop smoothly with the main speaker. Fit+blur keeps everyone in frame.</p>
        <div className="flex flex-wrap gap-1">
          <button className="btn-primary h-7 px-2 text-[12px]" onClick={onFollowFace}>Follow the speaker&apos;s face</button>
          <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => onConfig({ framing: "blur" })}>Fit+blur</button>
          <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => onConfig({ framing: "crop" })}>Fixed crop</button>
        </div>
      </Tool>

      <Tool title="Smart Export">
        <p className="mb-2">Suggested: {smart.aspect}, {smart.resolution}, {smart.framing === "follow" ? "follow face" : "crop"}, {PRESET_INFO[smart.preset!].label}{smart.removeSilence ? ", silence removal on" : ""}.</p>
        <button className="btn-secondary h-7 px-2 text-[12px]" onClick={() => { onConfig({ ...smart, style: { ...doc.config.style, preset: PRESET_INFO[smart.preset!].subtitle } }); toast({ tone: "success", title: "Export settings applied" }); }}>Apply suggestion</button>
      </Tool>

      <Tool title="Auto Clip">
        <p className="mb-2">Find clip candidates again for the whole source video. Favourite and accepted clips are kept.</p>
        <button className="btn-secondary h-7 px-2 text-[12px]" disabled={busy === "ana"} onClick={() => run("ana", async () => { await api(`/api/sources/${sourceId}/analyze`, { method: "POST" }); toast({ tone: "success", title: "Analysis queued", body: "New candidates appear in the project gallery." }); })}>Reprocess source</button>
      </Tool>

      <Tool title="Audio Enhancement" tag="always on">
        <p>High-pass at 70 Hz and loudness normalisation to −14 LUFS are applied to every render.</p>
      </Tool>

      <Tool title="AI Script" tag="not available">
        <p>Writing new script text needs a language-model provider, which is not configured on this server. Nothing will be invented in its place.</p>
      </Tool>
    </div>
  );
}
