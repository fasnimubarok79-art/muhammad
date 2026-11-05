"use client";

import { useEffect, useRef, useState } from "react";
import { api, ClientApiError, fmtBytes, fmtTime, newIdempotencyKey } from "@/lib/client";
import { StatusPill } from "../ui/bits";
import { useToast } from "../ui/use-toast";
import { useSession } from "../app/session";
import type { Config } from "./useEditor";

type Quote = { lines: Array<{ label: string; amount: number }>; total: number; charged: number; unlimited: boolean };
type Job = { id: string; status: string; progress: number; error: string | null; hasOutput: boolean; outputMeta: { durationSec?: number; sizeBytes?: number; video?: { width: number; height: number; fps: number; codec: string }; audio?: { codec: string }; removedSec?: number } | null };

/** Shows the exact token cost first, then renders, polls the backend job, previews and downloads. */
export function ExportDialog({ clipId, config, summary, onClose, beforeRender }: { clipId: string; config: Config; summary: string; onClose: () => void; beforeRender: () => Promise<unknown> }) {
  const toast = useToast();
  const { user, refresh } = useSession();
  const [res, setRes] = useState<Config["resolution"]>(config.resolution);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    setQuote(null);
    api<{ quote: Quote; balance: number }>(`/api/clips/${clipId}/render?resolution=${res}`).then((r) => { setQuote(r.quote); setBalance(r.balance); }, () => setErr("Could not load the price"));
    key.current = newIdempotencyKey();
  }, [clipId, res]);

  useEffect(() => {
    if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ job: Job }>(`/api/jobs/${job.id}`);
        setJob(r.job);
        if (["completed", "failed", "cancelled"].includes(r.job.status)) void refresh();
      } catch {}
    }, 1500);
    return () => clearInterval(t);
  }, [job, refresh]);

  async function render() {
    if (!quote) return;
    setBusy(true);
    setErr(null);
    try {
      await beforeRender();
      const r = await api<{ job: Job }>(`/api/clips/${clipId}/render`, {
        body: { idempotencyKey: key.current, confirmTotal: quote.charged, params: { ...config, resolution: res, style: { ...config.style } } },
      });
      setJob(r.job);
      void refresh();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.body.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!job) return;
    try {
      const r = await api<{ charged: number; alreadyPaid: boolean; url: string }>(`/api/renders/${job.id}/download`, { method: "POST" });
      toast({ tone: "success", title: r.alreadyPaid ? "Downloading (already paid)" : `Downloading · ${r.charged} tokens` });
      void refresh();
      window.location.href = r.url;
    } catch (e) {
      toast({ tone: "error", title: "Download not started", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  }

  const insufficient = quote && !quote.unlimited && balance !== null && balance < quote.charged;
  const done = job?.status === "completed";

  return (
    <dialog ref={dialog} onClose={onClose} className="card m-auto w-[min(560px,calc(100vw-32px))] p-0 text-ink shadow-float backdrop:bg-black/60" aria-labelledby="exp-h">
      <div className="flex items-center border-b border-line px-5 py-3">
        <h2 id="exp-h" className="text-[18px] font-bold">Export</h2>
        <button className="btn-ghost ml-auto" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <div className="px-5 py-4">
        {!job && (
          <>
            <p className="label">Resolution</p>
            <div role="radiogroup" aria-label="Resolution" className="grid grid-cols-3 gap-2">
              {(["450p", "720p", "1080p"] as const).map((r) => (
                <button key={r} role="radio" aria-checked={res === r} onClick={() => setRes(r)} className={`rounded-ctl border px-3 py-2 text-left ${res === r ? "border-edit bg-edit/10" : "border-line bg-surface2"}`}>
                  <span className="block text-[14px] font-semibold">{r}</span>
                  <span className="text-[12px] text-muted">{r === "1080p" ? "+400 tokens" : "Standard"}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-muted">{config.aspect} · {config.framing === "blur" ? "fit+blur" : config.framing} · H.264 + AAC MP4 · {config.burnSubtitles ? "subtitles burned in" : "no subtitles"} · {summary}</p>

            <div className="mt-4 rounded-ctl border border-line bg-surface2 p-3 text-[13px]">
              {!quote ? <p className="text-muted">Loading price...</p> : (
                <>
                  {quote.lines.map((l) => (
                    <div key={l.label} className="flex justify-between tc"><span>{l.label}</span><span>{l.amount} tokens</span></div>
                  ))}
                  <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold tc">
                    <span>Total charged now</span>
                    <span>{quote.unlimited ? "0 (unlimited account)" : `${quote.charged} tokens`}</span>
                  </div>
                  <p className="mt-2 text-[12px] text-muted">Downloading the finished file costs 10 tokens once. Watching the preview is free. Failed renders are refunded automatically.</p>
                  {!quote.unlimited && balance !== null && <p className="mt-1 text-[12px] text-muted tc">Your balance: {balance} tokens</p>}
                </>
              )}
            </div>
            {insufficient && <p role="alert" className="mt-3 text-[13px] text-danger">Not enough tokens for this export. Choose 720p or 450p.</p>}
            {err && <p role="alert" className="mt-3 text-[13px] text-danger">{err}</p>}
            <button className="btn-primary mt-4 w-full" disabled={!quote || busy || Boolean(insufficient)} onClick={render}>
              {busy ? "Starting..." : quote ? `Render ${res}${quote.unlimited ? "" : ` · ${quote.charged} tokens`}` : "Render"}
            </button>
          </>
        )}

        {job && (
          <div>
            <div className="flex items-center gap-2">
              <StatusPill status={job.status} progress={job.progress} />
              {job.error && <span className="text-[13px] text-danger">{job.error}</span>}
            </div>
            {!done && job.status !== "failed" && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-system transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
              </div>
            )}
            {job.status === "failed" && <p className="mt-2 text-[13px] text-muted">Reserved tokens were returned to your balance.</p>}
            {done && (
              <>
                <video className="mt-3 max-h-[50vh] w-full rounded-ctl bg-black" src={`/api/media/render/${job.id}`} controls playsInline />
                <p className="mt-2 text-[12px] text-muted tc">
                  Verified with ffprobe: {job.outputMeta?.video ? `${job.outputMeta.video.width}×${job.outputMeta.video.height} ${job.outputMeta.video.codec.toUpperCase()} ${Math.round(job.outputMeta.video.fps)}fps` : ""} · {job.outputMeta?.audio?.codec.toUpperCase()} · {fmtTime(job.outputMeta?.durationSec ?? null)} · {fmtBytes(job.outputMeta?.sizeBytes)}
                  {job.outputMeta?.removedSec ? ` · ${job.outputMeta.removedSec}s of silence removed` : ""}
                </p>
                <button className="btn-primary mt-3 w-full" onClick={download}>{user?.unlimited ? "Download MP4" : "Download MP4 · 10 tokens"}</button>
              </>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
