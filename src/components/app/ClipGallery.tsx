"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ClientApiError, fmtTime } from "@/lib/client";
import { activeSubtitle } from "../studio/Player";
import type { Seg } from "../studio/useEditor";
import { Empty, ErrorNote, Spinner, StatusPill } from "../ui/bits";
import { useToast } from "../ui/use-toast";

export type GalleryClip = {
  id: string;
  projectId: string;
  project?: { title: string };
  sourceVideoId: string;
  startSec: number;
  endSec: number;
  duration: number;
  title: string;
  description: string | null;
  score: number | null;
  hookScore: number | null;
  engagementScore: number | null;
  hookText: string | null;
  targetDuration: number | null;
  insights: { why: string; moments: string[]; momentsBasis: string; platforms: Array<{ platform: string; aspect: string }> } | null;
  status: string;
  favorite: boolean;
  hasThumbnail: boolean;
  segments: Seg[];
  _count: { segments: number };
  latestRender: { id: string; status: string; progress: number; hasOutput: boolean } | null;
};

// Only one preview plays at a time across the gallery.
let playingVideo: HTMLVideoElement | null = null;

const RUNNING = ["queued", "validating", "downloading", "analyzing", "transcribing", "editing", "rendering"];

/** 9:16 media: the finished render if there is one, otherwise the source cropped to 9:16 with live captions. */
function ClipMedia({ clip }: { clip: GalleryClip }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [t, setT] = useState(0);
  const rendered = clip.latestRender?.status === "completed" && clip.latestRender.hasOutput;
  const offset = rendered ? 0 : clip.startSec;
  const end = rendered ? Infinity : clip.endSec;

  const play = useCallback(async () => {
    const v = ref.current;
    if (!v) return;
    if (playingVideo && playingVideo !== v) playingVideo.pause();
    playingVideo = v;
    setState("loading");
    if (!rendered && (v.currentTime < clip.startSec || v.currentTime >= clip.endSec)) v.currentTime = clip.startSec;
    try {
      await v.play();
    } catch {
      setState("error");
    }
  }, [clip.startSec, clip.endSec, rendered]);

  // per-frame clock so the caption overlay follows the real playback time
  useEffect(() => {
    if (state !== "playing" || rendered) return;
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) setT(v.currentTime - offset);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, rendered, offset]);

  const sub = !rendered && state === "playing" ? activeSubtitle(clip.segments, t) : null;
  const preview = !rendered && state !== "playing" ? clip.segments[0] : null;

  return (
    <div className="sub-preview relative aspect-[9/16] w-full overflow-hidden rounded-[8px] bg-black">
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover"
        src={rendered ? `/api/media/render/${clip.latestRender!.id}#t=0.4` : `/api/media/source/${clip.sourceVideoId}#t=${clip.startSec.toFixed(2)}`}
        preload={rendered ? "metadata" : "none"}
        playsInline
        controls={state === "playing"}
        onPlaying={() => setState("playing")}
        onPause={() => setState((s) => (s === "playing" ? "idle" : s))}
        onError={() => setState("error")}
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime >= end) {
            e.currentTarget.pause();
            e.currentTarget.currentTime = clip.startSec;
          }
        }}
      />
      {/* still frame before playing: the thumbnail cropped to 9:16 (renders show their own first frame) */}
      {!rendered && state !== "playing" && clip.hasThumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/thumb/${clip.id}`} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      )}
      {/* captions: huge, centred, heavy stroke, yellow active word */}
      {(sub || preview) && (
        <div className="pointer-events-none absolute inset-x-[6%] top-1/2 flex -translate-y-1/2 justify-center">
          <p className="sub-line" style={{ fontSize: "9.5cqw", ["--hl" as string]: "#FFD21F", WebkitTextStrokeWidth: "0.11em", textShadow: "0 0.06em 0 rgb(0 0 0 / .85)" }}>
            {(sub ? sub.seg.words : preview!.words.slice(0, 6)).map((w, i) => (
              <span key={i}>
                {i > 0 ? " " : ""}
                <span className={sub && i === sub.idx ? "sub-word-active sub-pop" : ""}>{w.w}</span>
              </span>
            ))}
          </p>
        </div>
      )}
      {clip.score != null && (
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/75 px-2.5 py-1 text-[12px] font-bold text-white ring-1 ring-edit/80 shadow-[0_0_14px_rgb(255_122_26/.55)] tc" title="Viral potential: an estimate from hook, pacing, dead air, completeness, topic and length. Not a guarantee of views.">
          🔥 Viral {Math.round(clip.score)}
        </span>
      )}
      <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[12px] font-semibold text-white tc">{fmtTime(clip.duration, false)}</span>
      {rendered && <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-system px-1.5 py-0.5 text-[11px] font-bold text-bg">MP4 siap</span>}
      {state !== "playing" && (
        <button onClick={play} className="absolute inset-0 grid place-items-center" aria-label={`Putar ${clip.hookText ?? clip.title}`}>
          {state === "loading" ? (
            <Spinner label="Memuat" />
          ) : state === "error" ? (
            <span className="rounded-ctl bg-bg/90 px-3 py-1.5 text-[13px] text-danger">Pratinjau tidak tersedia</span>
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function ClipCard({ clip, selected, onSelect, onChanged, showProject }: { clip: GalleryClip; selected: boolean; onSelect: (v: boolean) => void; onChanged: () => void; showProject: boolean }) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const rendered = clip.latestRender?.status === "completed" && clip.latestRender.hasOutput;
  const running = clip.latestRender && RUNNING.includes(clip.latestRender.status);
  const snippet = clip.segments.map((s) => s.text).join(" ");

  const patch = async (body: Record<string, unknown>, ok: string) => {
    try {
      await api(`/api/clips/${clip.id}`, { method: "PATCH", body });
      toast({ tone: "success", title: ok });
      onChanged();
    } catch (e) {
      toast({ tone: "error", title: "Tidak tersimpan", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  const download = async () => {
    try {
      const r = await api<{ charged: number; alreadyPaid: boolean; url: string }>(`/api/renders/${clip.latestRender!.id}/download`, { method: "POST" });
      toast({ tone: "success", title: r.alreadyPaid ? "Mengunduh (sudah dibayar)" : `Mengunduh · ${r.charged} token` });
      window.location.href = r.url;
    } catch (e) {
      toast({ tone: "error", title: "Unduhan gagal dimulai", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  const copyLink = async () => {
    const url = `${window.location.origin}/studio/${clip.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ tone: "success", title: "Tautan disalin", body: "Tautan ini hanya bisa dibuka setelah login ke akun Anda." });
    } catch {
      toast({ tone: "error", title: "Tidak bisa menyalin", body: url });
    }
  };

  return (
    <article className={`card flex flex-col p-2.5 ${selected ? "border-system" : ""}`} aria-labelledby={`t-${clip.id}`}>
      <ClipMedia clip={clip} />
      <div className="flex flex-1 flex-col px-1 pt-3">
        <div className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#3DDC97]" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Pilih ${clip.title}`} />
          <h3 id={`t-${clip.id}`} className="line-clamp-2 font-sans text-[15px] font-bold leading-snug" style={{ fontStretch: "100%" }}>{clip.hookText ?? clip.title}</h3>
        </div>
        <p className="mt-1.5 text-[12px] text-muted tc">
          {fmtTime(clip.startSec, false)} → {fmtTime(clip.endSec, false)} · {Math.round(clip.duration)} dtk
          {clip.hookScore != null && <> · Hook {Math.round(clip.hookScore)}</>}
          {showProject && clip.project && <> · {clip.project.title}</>}
        </p>
        {snippet && <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-faint">&ldquo;{snippet}&rdquo;</p>}
        {running && <div className="mt-2"><StatusPill status={clip.latestRender!.status} progress={clip.latestRender!.progress} /></div>}

        <div className="mt-auto pt-3">
          <div className="grid grid-cols-2 gap-2">
            {rendered ? (
              <button className="btn h-9 bg-system px-2 text-[13px] text-bg hover:brightness-110" onClick={download} title="10 token, sekali per file">Unduh MP4</button>
            ) : (
              <Link href={`/studio/${clip.id}?panel=export`} className="btn h-9 bg-system px-2 text-[13px] text-bg hover:brightness-110" title="Render dulu, lalu unduh">Render MP4</Link>
            )}
            <button className="btn-secondary h-9 px-2 text-[13px]" onClick={copyLink}>Salin tautan</button>
          </div>
          <div className="mt-1.5 flex items-center">
            <Link href={`/studio/${clip.id}`} className="btn-ghost h-8 px-1.5 text-[12px]">Edit</Link>
            <button className="btn-ghost h-8 px-1.5 text-[12px]" aria-pressed={clip.favorite} onClick={() => patch({ favorite: !clip.favorite }, clip.favorite ? "Dihapus dari favorit" : "Ditambahkan ke favorit")}>
              <span className={clip.favorite ? "text-edit" : ""}>{clip.favorite ? "★ Favorit" : "☆ Favorit"}</span>
            </button>
            <div className="relative ml-auto">
              <button className="btn-ghost h-8 px-1.5 text-[12px]" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>Lainnya</button>
              {menu && (
                <div role="menu" className="card shadow-float absolute bottom-9 right-0 z-10 flex w-44 flex-col p-1" onMouseLeave={() => setMenu(false)}>
                  <button role="menuitem" className="rounded px-3 py-2 text-left text-[13px] hover:bg-surface2" onClick={() => { setMenu(false); void patch({ status: "accepted" }, "Klip diterima"); }}>Terima</button>
                  <button role="menuitem" className="rounded px-3 py-2 text-left text-[13px] hover:bg-surface2" onClick={() => { setMenu(false); void patch({ status: "rejected" }, "Klip ditolak"); }}>Tolak</button>
                  <a role="menuitem" className="rounded px-3 py-2 text-[13px] hover:bg-surface2" href={`/api/clips/${clip.id}/captions?format=srt`}>Subtitle (.srt)</a>
                  <a role="menuitem" className="rounded px-3 py-2 text-[13px] hover:bg-surface2" href={`/api/clips/${clip.id}/captions?format=vtt`}>Subtitle (.vtt)</a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ClipGallery({ projectId, refreshKey = 0, viral = false, title = "Klip" }: { projectId?: string; refreshKey?: number; viral?: boolean; title?: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [fav, setFav] = useState(false);
  const [sort, setSort] = useState("score");
  const [length, setLength] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; clips: GalleryClip[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ sort, page: String(page), pageSize: "12" });
    if (projectId) sp.set("projectId", projectId);
    if (viral) sp.set("minScore", "70");
    if (q.trim()) sp.set("q", q.trim());
    if (status) sp.set("status", status);
    if (fav) sp.set("favorite", "1");
    if (length) sp.set("length", length);
    try {
      setData(await api(`/api/clips?${sp}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat klip");
    }
  }, [projectId, viral, q, status, fav, sort, page, length]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q, refreshKey]);

  useEffect(() => {
    if (!data?.clips.some((c) => c.latestRender && RUNNING.includes(c.latestRender.status))) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data, load]);

  const bulk = async (body: Record<string, unknown>, label: string) => {
    const ids = Array.from(selected);
    const results = await Promise.allSettled(ids.map((id) => api(`/api/clips/${id}`, { method: "PATCH", body })));
    const failed = results.filter((r) => r.status === "rejected").length;
    toast({ tone: failed ? "error" : "success", title: `${label}: ${ids.length - failed} dari ${ids.length}` });
    setSelected(new Set());
    void load();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(q || status || fav || length);

  return (
    <section aria-labelledby="gallery-h">
      <div className="flex flex-wrap items-end gap-2.5">
        <h2 id="gallery-h" className="mr-auto text-[22px] font-extrabold">{title} {data ? <span className="text-muted tc">({data.total})</span> : null}</h2>
        <label className="sr-only" htmlFor="cq">Cari klip</label>
        <input id="cq" className="field h-9 w-44" placeholder="Cari judul atau teks" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label className="sr-only" htmlFor="clen">Durasi</label>
        <select id="clen" className="field h-9 w-32" value={length} onChange={(e) => { setLength(e.target.value); setPage(1); }}>
          <option value="">Semua durasi</option>
          <option value="15">15 dtk</option>
          <option value="30">30 dtk</option>
          <option value="45">45 dtk</option>
          <option value="60">60 dtk</option>
        </select>
        <label className="sr-only" htmlFor="cs">Status</label>
        <select id="cs" className="field h-9 w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Semua status</option>
          <option value="candidate">Kandidat</option>
          <option value="accepted">Diterima</option>
          <option value="rejected">Ditolak</option>
        </select>
        <label className="sr-only" htmlFor="csort">Urutkan</label>
        <select id="csort" className="field h-9 w-44" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Skor viral tertinggi</option>
          <option value="hook">Hook terkuat</option>
          <option value="engagement">Engagement tertinggi</option>
          <option value="start">Urutan waktu</option>
          <option value="newest">Terbaru</option>
        </select>
        <label className="flex h-9 items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-[#3DDC97]" checked={fav} onChange={(e) => { setFav(e.target.checked); setPage(1); }} /> Favorit
        </label>
      </div>
      {viral && <p className="mt-2 text-[12px] text-muted">Klip dengan skor viral 70 ke atas. Skor adalah estimasi dari transkrip dan audio, bukan jaminan jumlah penonton.</p>}

      {selected.size > 0 && (
        <div className="card mt-4 flex flex-wrap items-center gap-2 px-3 py-2" role="region" aria-label="Aksi massal">
          <span className="text-[13px] font-semibold tc">{selected.size} dipilih</span>
          <button className="btn-secondary h-8" onClick={() => bulk({ status: "accepted" }, "Diterima")}>Terima</button>
          <button className="btn-secondary h-8" onClick={() => bulk({ status: "rejected" }, "Ditolak")}>Tolak</button>
          <button className="btn-secondary h-8" onClick={() => bulk({ favorite: true }, "Difavoritkan")}>Favorit</button>
          <button className="btn-ghost h-8" onClick={() => setSelected(new Set())}>Batal</button>
        </div>
      )}

      <div className="mt-5">
        {error && <ErrorNote message={error} onRetry={load} />}
        {!data && !error && <Spinner label="Memuat klip" />}
        {data && data.clips.length === 0 && (
          <Empty title={filtered ? "Tidak ada klip yang cocok" : viral ? "Belum ada klip dengan skor 70 ke atas" : "Belum ada klip"}>
            {filtered ? "Hapus pencarian atau filter." : "Tempel link video di atas lalu tekan Generate, atau unggah video di sebuah proyek."}
          </Empty>
        )}
        {data && data.clips.length > 0 && (
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.clips.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                showProject={!projectId}
                selected={selected.has(c.id)}
                onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(c.id); else n.delete(c.id); return n; })}
                onChanged={load}
              />
            ))}
          </div>
        )}
        {data && pages > 1 && (
          <nav aria-label="Halaman klip" className="mt-6 flex items-center justify-center gap-3">
            <button className="btn-secondary h-9" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Sebelumnya</button>
            <span className="text-[13px] tc">Halaman {page} dari {pages}</span>
            <button className="btn-secondary h-9" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Berikutnya</button>
          </nav>
        )}
      </div>
    </section>
  );
}
