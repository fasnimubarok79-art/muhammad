"use client";

import { useRef, type ReactNode } from "react";
import { api, ClientApiError, fmtTime } from "@/lib/client";
import { useToast } from "../ui/use-toast";
import { retext, retime, DEFAULT_STYLE, type Config, type Doc, type Seg, type Style } from "./useEditor";

/** Style values a subtitle animation brings with it (Impact is big, centred and yellow). */
export function styleFor(preset: Style["preset"], current: Style): Style {
  if (preset === "impact") return { ...current, preset, fontSize: 108, highlight: "#FFD21F", outline: 10, shadow: 5, marginV: 840 };
  if (preset === "punch") return { ...current, preset, fontSize: 62, outline: 6, shadow: 3, marginV: 640 };
  if (current.preset === "impact" || current.preset === "punch") return { ...current, preset, fontSize: DEFAULT_STYLE.fontSize, highlight: DEFAULT_STYLE.highlight, outline: DEFAULT_STYLE.outline, shadow: DEFAULT_STYLE.shadow, marginV: DEFAULT_STYLE.marginV };
  return { ...current, preset };
}

export const PRESET_INFO: Record<Config["preset"], { label: string; note: string; subtitle: Style["preset"] }> = {
  cinematic_punch: { label: "Cinematic Punch", note: "Warm moody grade, punch-in zoom on sentence starts with a flash cut, big coloured keyword captions", subtitle: "punch" },
  cinematic_podcast: { label: "Cinematic Podcast", note: "Natural grade, subtle push-in, clean captions", subtitle: "clean" },
  viral_short: { label: "Viral Short", note: "Karaoke captions, punchier grade, slow zoom", subtitle: "karaoke" },
  viral_spotlight: { label: "Viral Spotlight", note: "Huge centred yellow captions, zoom-in, grid + vignette background, orange glow around the frame (with Fit+blur)", subtitle: "impact" },
  educational: { label: "Educational", note: "Clear captions, no zoom, minimal effects", subtitle: "clean" },
  storytelling: { label: "Storytelling", note: "Warm grade, longer fades, karaoke captions", subtitle: "karaoke" },
  clean_professional: { label: "Clean Professional", note: "No grade, no zoom, precise captions", subtitle: "clean" },
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <h3 className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wide text-faint" style={{ fontStretch: "100%" }}>{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="w-24 shrink-0 text-[12px] text-muted">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Seg3<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ v: T; l: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-ctl bg-surface2 p-0.5">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={`h-7 rounded-[5px] text-[12px] font-medium ${value === o.v ? "bg-bg text-ink" : "text-muted hover:text-ink"}`}>{o.l}</button>
      ))}
    </div>
  );
}

export type FaceStatus = { state: "none" | "detecting" | "ready" | "error"; sampled?: number; withFace?: number; message?: string };

export function Inspector({ doc, clipLen, onConfig, onDoc, face, onDetectFaces }: { doc: Doc; clipLen: number; onConfig: (c: Partial<Config>, group?: boolean) => void; onDoc: (d: Partial<Doc>, group?: boolean) => void; face: FaceStatus; onDetectFaces: () => void }) {
  const c = doc.config;
  const st = (s: Partial<Style>, group = true) => onConfig({ style: { ...c.style, ...s } }, group);
  return (
    <div className="text-[13px]">
      <Group title="Clip">
        <div>
          <label htmlFor="i-title" className="label">Title</label>
          <input id="i-title" className="field h-9" value={doc.title} maxLength={140} onChange={(e) => onDoc({ title: e.target.value }, true)} />
        </div>
        <div>
          <label htmlFor="i-desc" className="label">Description</label>
          <textarea id="i-desc" className="field h-20 py-2" value={doc.description} maxLength={2000} onChange={(e) => onDoc({ description: e.target.value }, true)} />
        </div>
        <Row label="Trim in" htmlFor="i-tin">
          <input id="i-tin" type="number" step={0.1} min={0} max={c.trimEnd - 0.5} className="field h-8 tc" value={c.trimStart.toFixed(2)} onChange={(e) => onConfig({ trimStart: Math.max(0, Math.min(Number(e.target.value), c.trimEnd - 0.5)) })} />
        </Row>
        <Row label="Trim out" htmlFor="i-tout">
          <input id="i-tout" type="number" step={0.1} min={c.trimStart + 0.5} max={clipLen} className="field h-8 tc" value={c.trimEnd.toFixed(2)} onChange={(e) => onConfig({ trimEnd: Math.min(clipLen, Math.max(Number(e.target.value), c.trimStart + 0.5)) })} />
        </Row>
        <p className="text-[12px] text-faint tc">Length {fmtTime(c.trimEnd - c.trimStart)}</p>
      </Group>

      <Group title="Format and framing">
        <Row label="Aspect"><Seg3 label="Aspect ratio" value={c.aspect} onChange={(v) => onConfig({ aspect: v })} options={[{ v: "9:16", l: "9:16" }, { v: "1:1", l: "1:1" }, { v: "16:9", l: "16:9" }]} /></Row>
        <Row label="Framing"><Seg3 label="Framing" value={c.framing} onChange={(v) => onConfig({ framing: v })} options={[{ v: "blur", l: "Fit+blur" }, { v: "crop", l: "Crop" }, { v: "follow", l: "Follow face" }, { v: "pad", l: "Bars" }]} /></Row>
        {c.framing === "follow" && (
          <div className="rounded-ctl bg-surface2 px-2.5 py-2 text-[12px]" role="status">
            {face.state === "detecting" && <span className="text-muted">Finding faces in this clip...</span>}
            {face.state === "ready" && (face.withFace ? <span className="text-system">Face found in {face.withFace} of {face.sampled} sampled frames. The crop follows it.</span> : <span className="text-warn">No face found, so the crop stays centred.</span>)}
            {face.state === "error" && <span className="text-danger">{face.message}</span>}
            {face.state === "none" && <button className="btn-secondary h-7 px-2 text-[12px]" onClick={onDetectFaces}>Detect faces</button>}
          </div>
        )}
        {c.framing === "crop" && (
          <Row label="Crop focus" htmlFor="i-cx">
            <input id="i-cx" type="range" min={0} max={1} step={0.01} value={c.cropX} onChange={(e) => onConfig({ cropX: Number(e.target.value) }, true)} className="w-full accent-[#FF7A1A]" />
          </Row>
        )}
        <p className="text-[12px] text-faint">The picture is never stretched: crop fills the frame, fit keeps the whole shot.</p>
      </Group>

      <Group title="Look (preset)">
        <select aria-label="Editing preset" className="field h-9" value={c.preset} onChange={(e) => { const p = e.target.value as Config["preset"]; onConfig({ preset: p, style: styleFor(PRESET_INFO[p].subtitle, c.style), ...(p === "viral_spotlight" && c.framing === "pad" ? { framing: "blur" as const } : {}) }); }}>
          {Object.entries(PRESET_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <p className="text-[12px] text-muted">{PRESET_INFO[c.preset].note}</p>
      </Group>

      <Group title="Subtitles">
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#3DDC97]" checked={c.burnSubtitles} onChange={(e) => onConfig({ burnSubtitles: e.target.checked })} /> Burn subtitles into the video</label>
        <Row label="Animation"><Seg3 label="Subtitle animation" value={c.style.preset} onChange={(v) => onConfig({ style: styleFor(v, c.style) })} options={[{ v: "punch", l: "Punch" }, { v: "karaoke", l: "Karaoke" }, { v: "pop", l: "Pop" }, { v: "impact", l: "Impact" }, { v: "clean", l: "Clean" }]} /></Row>
        <Row label="Size" htmlFor="i-fs"><input id="i-fs" type="range" min={48} max={140} value={c.style.fontSize} onChange={(e) => st({ fontSize: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" /></Row>
        <Row label="Position" htmlFor="i-mv"><input id="i-mv" type="range" min={300} max={1500} step={10} value={c.style.marginV} onChange={(e) => st({ marginV: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" aria-describedby="i-mv-h" /></Row>
        <p id="i-mv-h" className="-mt-1 text-[11px] text-faint">Distance from the bottom. Keep it above the bottom 21% safe zone.</p>
        <Row label="Text colour" htmlFor="i-pc"><input id="i-pc" type="color" value={c.style.primary} onChange={(e) => st({ primary: e.target.value.toUpperCase() })} className="h-8 w-full rounded bg-surface2" /></Row>
        <Row label="Highlight" htmlFor="i-hc"><input id="i-hc" type="color" value={c.style.highlight} onChange={(e) => st({ highlight: e.target.value.toUpperCase() })} className="h-8 w-full rounded bg-surface2" /></Row>
        <Row label="Outline" htmlFor="i-ol"><input id="i-ol" type="range" min={0} max={14} value={c.style.outline} onChange={(e) => st({ outline: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" /></Row>
        <Row label="Shadow" htmlFor="i-sh"><input id="i-sh" type="range" min={0} max={10} value={c.style.shadow} onChange={(e) => st({ shadow: Number(e.target.value) })} className="w-full accent-[#FF7A1A]" /></Row>
      </Group>

      <Group title="Audio">
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#3DDC97]" checked={c.removeSilence} onChange={(e) => onConfig({ removeSilence: e.target.checked })} /> Remove silences longer than 0.6s</label>
        <p className="text-[12px] text-faint">Every render cleans low rumble and normalises loudness to −14 LUFS for phones.</p>
      </Group>
    </div>
  );
}

export function SubtitleList({ doc, clipId, time, selected, onSelect, onSegments, onSeek, onReplaced }: { doc: Doc; clipId: string; time: number; selected: number | null; onSelect: (i: number) => void; onSegments: (s: Seg[], group?: boolean) => void; onSeek: (t: number) => void; onReplaced: () => void }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const segs = doc.segments;
  const update = (i: number, s: Seg, group = true) => onSegments(segs.map((x, k) => (k === i ? s : x)), group);
  const len = doc.config.trimEnd;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1.5 border-b border-line p-2">
        <button
          className="btn-secondary h-8 px-2.5 text-[12px]"
          onClick={() => {
            const start = Math.max(0, time);
            const after = segs.find((s) => s.start > start);
            const end = Math.min(start + 1.5, after ? after.start : len, len);
            if (end - start < 0.2 || segs.some((s) => start >= s.start && start < s.end)) return toast({ tone: "error", title: "Move the playhead to a gap without subtitles" });
            const n = [...segs, { start, end, text: "New line", words: [{ w: "New", s: start, e: (start + end) / 2, p: -1 }, { w: "line", s: (start + end) / 2, e: end, p: -1 }] }].sort((a, b) => a.start - b.start);
            onSegments(n);
          }}
        >
          Add at playhead
        </button>
        <button className="btn-secondary h-8 px-2.5 text-[12px]" onClick={() => file.current?.click()}>Import SRT/VTT</button>
        <a className="btn-secondary h-8 px-2.5 text-[12px]" href={`/api/clips/${clipId}/captions?format=srt`}>SRT</a>
        <a className="btn-secondary h-8 px-2.5 text-[12px]" href={`/api/clips/${clipId}/captions?format=vtt`}>VTT</a>
        <input
          ref={file}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          className="sr-only"
          aria-label="Import subtitle file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const r = await api<{ count: number; skipped: number }>(`/api/clips/${clipId}/captions`, { method: "POST", raw: await f.text(), headers: { "Content-Type": "text/plain" } });
              toast({ tone: "success", title: `Imported ${r.count} lines`, body: r.skipped ? `${r.skipped} cues were outside this clip.` : "Word timing is spread evenly because SRT/VTT files carry none." });
              onReplaced();
            } catch (err) {
              toast({ tone: "error", title: "Import failed", body: err instanceof ClientApiError ? err.body.message : undefined });
            }
          }}
        />
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {segs.length === 0 && <li className="p-3 text-[13px] text-muted">No subtitles. Use Auto Caption in AI tools, import a file, or add a line.</li>}
        {segs.map((s, i) => {
          const active = time >= s.start && time < s.end;
          return (
            <li key={i} className={`border-b border-line px-2 py-2 ${selected === i ? "bg-surface2" : ""}`} onFocus={() => onSelect(i)}>
              <div className="flex items-center gap-1 text-[11px] tc">
                <button className={`rounded px-1 ${active ? "bg-edit text-bg" : "text-muted hover:text-ink"}`} onClick={() => { onSelect(i); onSeek(s.start); }} aria-label={`Seek to line ${i + 1}`}>{fmtTime(s.start)}</button>
                <input aria-label={`Line ${i + 1} start`} type="number" step={0.05} className="field h-6 w-[70px] px-1 text-[11px] tc" value={s.start.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < s.end - 0.05) update(i, retime(s, v, s.end)); }} />
                <span className="text-faint">→</span>
                <input aria-label={`Line ${i + 1} end`} type="number" step={0.05} className="field h-6 w-[70px] px-1 text-[11px] tc" value={s.end.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v > s.start + 0.05 && v <= len + 0.01) update(i, retime(s, s.start, v)); }} />
                <button className="ml-auto rounded px-1.5 text-faint hover:text-danger" aria-label={`Delete line ${i + 1}`} onClick={() => onSegments(segs.filter((_, k) => k !== i))}>Delete</button>
              </div>
              <textarea aria-label={`Line ${i + 1} text`} rows={2} className="field mt-1 h-auto resize-none px-2 py-1 text-[13px]" value={s.text} maxLength={300} onChange={(e) => update(i, retext(s, e.target.value))} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
