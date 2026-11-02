"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ClientApiError, fmtTime } from "@/lib/client";
import { Empty, ErrorNote, Spinner, StatusPill } from "../ui/bits";
import { useToast } from "../ui/use-toast";

export type GalleryClip = {
  id: string;
  sourceVideoId: string;
  startSec: number;
  endSec: number;
  duration: number;
  title: string;
  description: string | null;
  score: number | null;
  status: string;
  favorite: boolean;
  hasThumbnail: boolean;
  _count: { segments: number };
  latestRender: { id: string; status: string; progress: number; hasOutput: boolean } | null;
};

// Only one preview plays at a time across the gallery.
let playingVideo: HTMLVideoElement | null = null;

function ClipPreview({ clip }: { clip: GalleryClip }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const start = useCallback(async () => {
    const v = ref.current;
    if (!v) return;
    if (playingVideo && playingVideo !== v) playingVideo.pause();
    playingVideo = v;
    setState("loading");
    if (v.currentTime < clip.startSec || v.currentTime >= clip.endSec) v.currentTime = clip.startSec;
    try {
      await v.play();
    } catch {
      setState("error");
    }
  }, [clip.startSec, clip.endSec]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-ctl bg-bg">
      <video
        ref={ref}
        className="h-full w-full object-contain"
        src={`/api/media/source/${clip.sourceVideoId}#t=${clip.startSec.toFixed(2)}`}
        poster={clip.hasThumbnail ? `/api/media/thumb/${clip.id}` : undefined}
        preload="none"
        playsInline
        controls={state === "playing"}
        onPlaying={() => setState("playing")}
        onPause={() => setState((s) => (s === "playing" ? "idle" : s))}
        onError={() => setState("error")}
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime >= clip.endSec) {
            e.currentTarget.pause();
            e.currentTarget.currentTime = clip.startSec;
          }
        }}
      />
      {state !== "playing" && (
        <button onClick={start} className="absolute inset-0 grid place-items-center bg-bg/30 hover:bg-bg/10" aria-label={`Play preview of ${clip.title}`}>
          {state === "loading" ? (
            <Spinner label="Loading preview" />
          ) : state === "error" ? (
            <span className="rounded-ctl bg-bg/90 px-3 py-1.5 text-[13px] text-danger">Preview unavailable</span>
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-bg/80 text-ink">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
        </button>
      )}
      <span className="absolute bottom-2 right-2 rounded bg-bg/85 px-1.5 py-0.5 text-[12px] font-semibold tc">{fmtTime(clip.duration, false)}</span>
    </div>
  );
}

function ClipCard({ clip, selected, onSelect, onChanged }: { clip: GalleryClip; selected: boolean; onSelect: (v: boolean) => void; onChanged: () => void }) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const patch = async (body: Record<string, unknown>, ok: string) => {
    try {
      await api(`/api/clips/${clip.id}`, { method: "PATCH", body });
      toast({ tone: "success", title: ok });
      onChanged();
    } catch (e) {
      toast({ tone: "error", title: "Not saved", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  const download = async () => {
    if (!clip.latestRender?.hasOutput) return;
    try {
      const r = await api<{ charged: number; alreadyPaid: boolean; url: string }>(`/api/renders/${clip.latestRender.id}/download`, { method: "POST" });
      toast({ tone: "success", title: r.alreadyPaid ? "Downloading (already paid)" : `Downloading · ${r.charged} tokens` });
      window.location.href = r.url;
    } catch (e) {
      toast({ tone: "error", title: "Download not started", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  return (
    <article className={`card flex flex-col p-3 ${selected ? "border-system" : ""}`} aria-labelledby={`t-${clip.id}`}>
      <ClipPreview clip={clip} />
      <div className="mt-3 flex items-start gap-2 px-1">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[#3DDC97]" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${clip.title}`} />
        <div className="min-w-0 flex-1">
          <h3 id={`t-${clip.id}`} className="font-sans text-[15px] font-semibold leading-snug" style={{ fontStretch: "100%" }}>{clip.title}</h3>
          <p className="mt-1 text-[12px] text-muted tc">
            {fmtTime(clip.startSec)} → {fmtTime(clip.endSec)} · {clip._count.segments} subtitle lines
          </p>
          {clip.description && <p className="mt-2 line-clamp-2 text-[13px] text-muted">{clip.description}</p>}
        </div>
        {clip.score != null && (
          <div className="shrink-0 text-right" title="Estimated from hook, pacing, dead air, completeness, length and topic. Not a guarantee of views.">
            <p className="font-display text-[22px] font-extrabold leading-none tc">{Math.round(clip.score)}</p>
            <p className="text-[11px] text-muted">score (est.)</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
        {clip.status !== "candidate" && <span className={`text-[12px] font-semibold ${clip.status === "accepted" ? "text-system" : "text-muted"}`}>{clip.status === "accepted" ? "Accepted" : "Rejected"}</span>}
        {clip.latestRender && <StatusPill status={clip.latestRender.status} progress={clip.latestRender.progress} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line px-1 pt-3">
        <Link href={`/studio/${clip.id}`} className="btn-secondary h-9">Edit clip</Link>
        <Link href={`/studio/${clip.id}?panel=export`} className="btn-secondary h-9">Export</Link>
        <button className="btn-secondary h-9" disabled={!clip.latestRender?.hasOutput} onClick={download} title={clip.latestRender?.hasOutput ? "10 tokens, once per file" : "Render the clip first"}>Download</button>
        <button className="btn-ghost h-9" aria-pressed={clip.favorite} onClick={() => patch({ favorite: !clip.favorite }, clip.favorite ? "Removed from favourites" : "Added to favourites")}>
          <span className={clip.favorite ? "text-edit" : ""}>{clip.favorite ? "★ Favourite" : "☆ Favourite"}</span>
        </button>
        <div className="relative ml-auto">
          <button className="btn-ghost h-9" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>More</button>
          {menu && (
            <div role="menu" className="card shadow-float absolute bottom-10 right-0 z-10 flex w-44 flex-col p-1" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" className="rounded px-3 py-2 text-left text-[13px] hover:bg-surface2" onClick={() => { setMenu(false); void patch({ status: "accepted" }, "Clip accepted"); }}>Accept</button>
              <button role="menuitem" className="rounded px-3 py-2 text-left text-[13px] hover:bg-surface2" onClick={() => { setMenu(false); void patch({ status: "rejected" }, "Clip rejected"); }}>Reject</button>
              <button role="menuitem" className="rounded px-3 py-2 text-left text-[13px] hover:bg-surface2" onClick={() => { setMenu(false); void patch({ status: "candidate" }, "Moved back to candidates"); }}>Reset status</button>
              <a role="menuitem" className="rounded px-3 py-2 text-[13px] hover:bg-surface2" href={`/api/clips/${clip.id}/captions?format=srt`}>Subtitles (.srt)</a>
              <a role="menuitem" className="rounded px-3 py-2 text-[13px] hover:bg-surface2" href={`/api/clips/${clip.id}/captions?format=vtt`}>Subtitles (.vtt)</a>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function ClipGallery({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [fav, setFav] = useState(false);
  const [sort, setSort] = useState("score");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; clips: GalleryClip[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ projectId, sort, page: String(page), pageSize: "12" });
    if (q.trim()) sp.set("q", q.trim());
    if (status) sp.set("status", status);
    if (fav) sp.set("favorite", "1");
    try {
      setData(await api(`/api/clips?${sp}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clips");
    }
  }, [projectId, q, status, fav, sort, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q, refreshKey]);

  useEffect(() => {
    const running = data?.clips.some((c) => c.latestRender && !["completed", "failed", "cancelled"].includes(c.latestRender.status));
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data, load]);

  const bulk = async (body: Record<string, unknown>, label: string) => {
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => api(`/api/clips/${id}`, { method: "PATCH", body })));
    const failed = results.filter((r) => r.status === "rejected").length;
    toast({ tone: failed ? "error" : "success", title: `${label}: ${ids.length - failed} of ${ids.length}` });
    setSelected(new Set());
    void load();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section aria-labelledby="gallery-h">
      <div className="flex flex-wrap items-end gap-3">
        <h2 id="gallery-h" className="mr-auto text-[22px] font-extrabold">Clips {data ? <span className="text-muted tc">({data.total})</span> : null}</h2>
        <label className="sr-only" htmlFor="cq">Search clips</label>
        <input id="cq" className="field h-9 w-48" placeholder="Search title or text" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label className="sr-only" htmlFor="cs">Status</label>
        <select id="cs" className="field h-9 w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="candidate">Candidates</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <label className="sr-only" htmlFor="csort">Sort</label>
        <select id="csort" className="field h-9 w-40" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Highest score</option>
          <option value="start">Timeline order</option>
          <option value="newest">Newest</option>
          <option value="duration">Latest end time</option>
        </select>
        <label className="flex h-9 items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-[#3DDC97]" checked={fav} onChange={(e) => { setFav(e.target.checked); setPage(1); }} /> Favourites
        </label>
      </div>

      {selected.size > 0 && (
        <div className="card mt-4 flex flex-wrap items-center gap-2 px-3 py-2" role="region" aria-label="Bulk actions">
          <span className="text-[13px] font-semibold tc">{selected.size} selected</span>
          <button className="btn-secondary h-8" onClick={() => bulk({ status: "accepted" }, "Accepted")}>Accept</button>
          <button className="btn-secondary h-8" onClick={() => bulk({ status: "rejected" }, "Rejected")}>Reject</button>
          <button className="btn-secondary h-8" onClick={() => bulk({ favorite: true }, "Favourited")}>Favourite</button>
          <button className="btn-ghost h-8" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="mt-5">
        {error && <ErrorNote message={error} onRetry={load} />}
        {!data && !error && <Spinner label="Loading clips" />}
        {data && data.clips.length === 0 && (
          <Empty title={q || status || fav ? "No clips match these filters" : "No clips yet"}>
            {q || status || fav ? "Clear the search or filters." : "Clips appear here when the analysis of a video finishes."}
          </Empty>
        )}
        {data && data.clips.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.clips.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                selected={selected.has(c.id)}
                onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(c.id); else n.delete(c.id); return n; })}
                onChanged={load}
              />
            ))}
          </div>
        )}
        {data && pages > 1 && (
          <nav aria-label="Clip pages" className="mt-6 flex items-center justify-center gap-3">
            <button className="btn-secondary h-9" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-[13px] tc">Page {page} of {pages}</span>
            <button className="btn-secondary h-9" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </nav>
        )}
      </div>
    </section>
  );
}
