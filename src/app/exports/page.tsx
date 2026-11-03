"use client";

import Link from "next/link";
import { useCallback } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Empty, ErrorNote, Spinner, StatusPill } from "@/components/ui/bits";
import { useToast } from "@/components/ui/use-toast";
import { usePoll } from "@/hooks/usePoll";
import { api, ClientApiError, fmtBytes, fmtTime } from "@/lib/client";

type Job = {
  id: string; status: string; progress: number; error: string | null; createdAt: string; clipId: string | null; clipTitle: string | null; hasOutput: boolean; tokenCost: number;
  params: { resolution?: string; aspect?: string; preset?: string; framing?: string } | null;
  outputMeta: { durationSec?: number; sizeBytes?: number; video?: { width: number; height: number; codec: string } } | null;
};

const RUNNING = ["queued", "validating", "downloading", "analyzing", "transcribing", "editing", "rendering"];

export default function Exports() {
  const toast = useToast();
  const { data, error, refresh } = usePoll(() => api<{ jobs: Job[] }>("/api/jobs?kind=RENDER&limit=100"), useCallback((d: { jobs: Job[] }) => d.jobs.some((j) => RUNNING.includes(j.status)), []), 2500);
  const download = async (j: Job) => {
    try {
      const r = await api<{ charged: number; alreadyPaid: boolean; url: string }>(`/api/renders/${j.id}/download`, { method: "POST" });
      toast({ tone: "success", title: r.alreadyPaid ? "Mengunduh (sudah dibayar)" : `Mengunduh · ${r.charged} token` });
      window.location.href = r.url;
    } catch (e) {
      toast({ tone: "error", title: "Unduhan gagal dimulai", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Riwayat Export</h1>
      <p className="mt-1 text-muted">Semua render Anda. File yang selesai sudah dicek dengan ffprobe (codec, ukuran, durasi).</p>
      <div className="mt-6">
        {error && <ErrorNote message={error} onRetry={refresh} />}
        {!data && !error && <Spinner />}
        {data && data.jobs.length === 0 && <Empty title="Belum ada export">Buka sebuah klip, pilih Edit Video, lalu Export.</Empty>}
        {data && data.jobs.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Klip</th>
                  <th className="px-4 py-2 font-medium">Format</th>
                  <th className="px-4 py-2 font-medium">Hasil</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Waktu</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="max-w-[260px] px-4 py-2.5">
                      {j.clipId ? <Link href={`/studio/${j.clipId}`} className="line-clamp-2 font-medium hover:underline">{j.clipTitle ?? "Klip"}</Link> : <span className="text-muted">Klip dihapus</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted tc">{j.params?.resolution} · {j.params?.aspect} · {j.params?.preset?.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5 text-muted tc">
                      {j.outputMeta?.video ? `${j.outputMeta.video.width}×${j.outputMeta.video.height} · ${fmtTime(j.outputMeta.durationSec ?? null, false)} · ${fmtBytes(j.outputMeta.sizeBytes)}` : "–"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={j.status} progress={j.progress} />
                      {j.error && <p className="mt-1 text-[12px] text-danger">{j.error}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-muted tc">{new Date(j.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="flex justify-end gap-1.5">
                        {j.hasOutput && <a className="btn-secondary h-8 px-2.5 text-[12px]" href={`/api/media/render/${j.id}`} target="_blank" rel="noopener">Pratinjau</a>}
                        <button className="btn h-8 bg-system px-2.5 text-[12px] text-bg disabled:bg-surface2 disabled:text-faint" disabled={!j.hasOutput} onClick={() => download(j)}>Unduh MP4</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
