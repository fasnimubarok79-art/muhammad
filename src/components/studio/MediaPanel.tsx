"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ClientApiError, fmtBytes, fmtTime } from "@/lib/client";
import { useToast } from "../ui/use-toast";
import type { MediaInfo } from "@/lib/timeline/schema";
import { MEDIA_DRAG } from "./MultiTimeline";

export type LibAsset = { id: string; kind: "VIDEO" | "AUDIO" | "IMAGE"; name: string; mimeType: string; sizeBytes: number; durationSec: number | null; width: number | null; height: number | null; hasAudio: boolean; url: string; thumbUrl: string | null; usedBy: number; createdAt: string };
export type LibSource = { id: string; name: string; durationSec: number | null; width: number | null; height: number | null; hasAudio: boolean | null; url: string };
export type AddTarget = "main" | "broll" | "overlay" | "audio";

const ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-matroska,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,image/png,image/jpeg,image/webp";
const KIND_LABEL = { VIDEO: "Video", AUDIO: "Audio", IMAGE: "Image" } as const;

/** Media library: upload (button or drop), search, filter, sort, preview, rename, safe delete, add to the timeline. */
export const assetInfo = (a: LibAsset): MediaInfo => ({ ref: `asset:${a.id}`, kind: a.kind, name: a.name, durationSec: a.durationSec, width: a.width, height: a.height, hasAudio: a.hasAudio, url: a.url, thumbUrl: a.thumbUrl });
export const sourceInfo = (s: LibSource): MediaInfo => ({ ref: `source:${s.id}`, kind: "VIDEO", name: s.name, durationSec: s.durationSec, width: s.width, height: s.height, hasAudio: Boolean(s.hasAudio), url: s.url, thumbUrl: null });

export function MediaPanel({ projectId, onAdd, onKnown }: { projectId: string; onAdd: (info: MediaInfo, target: AddTarget) => void; onKnown: (infos: MediaInfo[]) => void }) {
  const toast = useToast();
  const [assets, setAssets] = useState<LibAsset[] | null>(null);
  const [sources, setSources] = useState<LibSource[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "VIDEO" | "AUDIO" | "IMAGE">("");
  const [sort, setSort] = useState<"new" | "name" | "duration">("new");
  const [uploads, setUploads] = useState<Array<{ name: string; pct: number }>>([]);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<LibAsset | LibSource | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sort, ...(q ? { q } : {}), ...(kind ? { kind } : {}) });
      const r = await api<{ assets: LibAsset[]; sources: LibSource[] }>(`/api/projects/${projectId}/media?${params}`);
      setAssets(r.assets);
      setSources(r.sources);
      onKnown([...r.assets.map(assetInfo), ...r.sources.map(sourceInfo)]);
    } catch (e) {
      toast({ tone: "error", title: "The library did not load", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  }, [projectId, q, kind, sort, toast, onKnown]);
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  /** Takes a copy of the files: resetting a file input empties its live FileList. */
  const upload = async (files: File[]) => {
    const csrf = (await fetch("/api/auth/me").then((r) => r.json())).csrfToken as string;
    for (const f of files) {
      setUploads((u) => [...u, { name: f.name, pct: 0 }]);
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/projects/${projectId}/media`);
        xhr.setRequestHeader("Content-Type", f.type || "application/octet-stream");
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(f.name));
        xhr.setRequestHeader("x-csrf-token", csrf);
        xhr.upload.onprogress = (ev) => ev.lengthComputable && setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, pct: Math.round((ev.loaded / ev.total) * 100) } : x)));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) toast({ tone: "success", title: `${f.name} added` });
          else {
            let msg = "Upload failed";
            try { msg = JSON.parse(xhr.responseText).error.message; } catch {}
            toast({ tone: "error", title: `${f.name} was not added`, body: msg });
          }
          resolve();
        };
        xhr.onerror = () => { toast({ tone: "error", title: `${f.name} was not added`, body: "Network error during upload." }); resolve(); };
        xhr.send(f);
      });
      setUploads((u) => u.filter((x) => x.name !== f.name));
    }
    void load();
  };

  const rename = async (a: LibAsset) => {
    const name = window.prompt("New name", a.name)?.trim();
    if (!name || name === a.name) return;
    try {
      await api(`/api/media-assets/${a.id}`, { method: "PATCH", body: { name } });
      void load();
    } catch (e) {
      toast({ tone: "error", title: "Not renamed", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  const remove = async (a: LibAsset) => {
    if (!window.confirm(`Delete "${a.name}" from your library? The file is removed permanently.`)) return;
    try {
      await api(`/api/media-assets/${a.id}`, { method: "DELETE" });
      toast({ tone: "success", title: "Deleted" });
      void load();
    } catch (e) {
      toast({ tone: "error", title: "Not deleted", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };

  const addButtons = (info: MediaInfo) => (
    <div className="flex flex-wrap gap-1">
      {info.kind !== "AUDIO" && <button className="btn-secondary h-6 px-1.5 text-[11px]" onClick={() => onAdd(info, "main")} aria-label={`Add ${info.name} to the main track`}>Main</button>}
      {info.kind !== "AUDIO" && <button className="btn-secondary h-6 px-1.5 text-[11px]" onClick={() => onAdd(info, "broll")} aria-label={`Add ${info.name} as B-roll`}>B-roll</button>}
      {info.kind !== "AUDIO" && <button className="btn-secondary h-6 px-1.5 text-[11px]" onClick={() => onAdd(info, "overlay")} aria-label={`Add ${info.name} as an overlay`}>Overlay</button>}
      {(info.kind === "AUDIO" || info.hasAudio) && <button className="btn-secondary h-6 px-1.5 text-[11px]" onClick={() => onAdd(info, "audio")} aria-label={`Add the sound of ${info.name} to the audio track`}>{info.kind === "AUDIO" ? "Add" : "Audio only"}</button>}
    </div>
  );

  return (
    <div
      className={`flex h-full min-h-0 flex-col ${over ? "outline outline-2 -outline-offset-2 outline-system" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { const f = Array.from(e.dataTransfer.files); if (f.length) { e.preventDefault(); setOver(false); void upload(f); } }}
    >
      <div className="flex flex-col gap-1.5 border-b border-line p-2">
        <div className="flex gap-1.5">
          <button className="btn-primary h-8 px-2.5 text-[12px]" onClick={() => file.current?.click()}>Upload media</button>
          <input ref={file} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Upload media files" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void upload(f); }} />
          <input type="search" className="field h-8 min-w-0 flex-1 px-2 text-[12px]" placeholder="Search" aria-label="Search media" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          <div role="radiogroup" aria-label="Media type" className="grid flex-1 auto-cols-fr grid-flow-col gap-0.5 rounded-ctl bg-surface2 p-0.5">
            {([["", "All"], ["VIDEO", "Video"], ["AUDIO", "Audio"], ["IMAGE", "Image"]] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={kind === v} onClick={() => setKind(v)} className={`h-6 rounded-[5px] text-[11px] font-medium ${kind === v ? "bg-bg text-ink" : "text-muted hover:text-ink"}`}>{l}</button>
            ))}
          </div>
          <select aria-label="Sort media" className="field h-7 w-auto px-1 text-[11px]" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="new">Newest</option>
            <option value="name">Name</option>
            <option value="duration">Longest</option>
          </select>
        </div>
        <p className="text-[11px] text-faint">Drop files here. Video, audio (MP3, WAV, M4A) or images. Drag an item onto a timeline track to place it.</p>
        {uploads.map((u) => (
          <div key={u.name} className="text-[11px] text-muted" role="status">
            Uploading {u.name} · {u.pct}%
            <div className="mt-0.5 h-1 rounded-full bg-surface2"><div className="h-full rounded-full bg-system" style={{ width: `${u.pct}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sources.length > 0 && (
          <section className="border-b border-line p-2">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Project videos</h3>
            <ul className="flex flex-col gap-1.5">
              {sources.map((s) => (
                <li key={s.id} draggable onDragStart={(e) => { e.dataTransfer.setData(MEDIA_DRAG, `source:${s.id}`); e.dataTransfer.effectAllowed = "copy"; }} className="rounded-ctl border border-line bg-surface2 p-1.5">
                  <button className="block w-full truncate text-left text-[12px] font-medium hover:text-edit" onClick={() => setPreview(s)}>{s.name}</button>
                  <p className="mb-1 text-[11px] text-muted tc">{s.durationSec ? fmtTime(s.durationSec, false) : "?"}{s.width ? ` · ${s.width}×${s.height}` : ""}</p>
                  {addButtons(sourceInfo(s))}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="p-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Library</h3>
          {assets === null && <p className="text-[12px] text-muted">Loading...</p>}
          {assets?.length === 0 && <p className="text-[12px] text-muted">{q || kind ? "Nothing matches." : "No files yet. Upload B-roll, music, logos or photos."}</p>}
          <ul className="flex flex-col gap-1.5">
            {assets?.map((a) => (
              <li key={a.id} draggable onDragStart={(e) => { e.dataTransfer.setData(MEDIA_DRAG, `asset:${a.id}`); e.dataTransfer.effectAllowed = "copy"; }} className="flex gap-2 rounded-ctl border border-line bg-surface2 p-1.5">
                <button className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded bg-bg text-[10px] text-faint" onClick={() => setPreview(a)} aria-label={`Preview ${a.name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.thumbUrl ? <img src={a.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : KIND_LABEL[a.kind]}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium" title={a.name}>{a.name}</p>
                  <p className="text-[11px] text-muted tc">{KIND_LABEL[a.kind]}{a.durationSec ? ` · ${fmtTime(a.durationSec, false)}` : ""}{a.width ? ` · ${a.width}×${a.height}` : ""} · {fmtBytes(a.sizeBytes)}{a.usedBy ? ` · used ${a.usedBy}×` : ""}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {addButtons(assetInfo(a))}
                    <button className="h-6 px-1 text-[11px] text-muted hover:text-ink" onClick={() => void rename(a)}>Rename</button>
                    <button className="h-6 px-1 text-[11px] text-faint hover:text-danger" onClick={() => void remove(a)}>Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {preview && (
        <div role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`} className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div className="card max-h-[90vh] w-full max-w-xl p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{preview.name}</p><button className="btn-ghost h-8 px-2 text-[12px]" onClick={() => setPreview(null)} autoFocus>Close</button></div>
            {"kind" in preview && preview.kind === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.name} className="max-h-[70vh] w-full rounded object-contain" />
            ) : "kind" in preview && preview.kind === "AUDIO" ? (
              <audio src={preview.url} controls className="w-full" />
            ) : (
              <video src={preview.url} controls playsInline className="max-h-[70vh] w-full rounded bg-black" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
