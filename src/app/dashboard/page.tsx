"use client";

import Link from "next/link";
import { useCallback } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Empty, ErrorNote, Spinner, StatusPill } from "@/components/ui/bits";
import { usePoll } from "@/hooks/usePoll";
import { api, fmtTime } from "@/lib/client";

type Job = { id: string; kind: string; status: string; progress: number; error: string | null; createdAt: string; projectId: string; clipId: string | null; clipTitle?: string | null; sourceName?: string | null; outputMeta?: { durationSec?: number; video?: { width: number; height: number } } | null };
type Dash = { stats: { projects: number; uploads: number; clips: number; activeJobs: number; videosAnalyzed: number; minutesProcessed: number }; tokens: { balance: number; unlimited: boolean }; activeJobs: Job[]; recentRenders: Job[]; activity: Job[] };
type Health = { checks: Record<string, { ok: boolean; detail: string }> };

const SERVICE_LABEL: Record<string, string> = { database: "Database", ffmpeg: "FFmpeg", ffprobe: "FFprobe", whisper: "Whisper STT", storage: "Storage", worker: "Background worker" };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card px-4 py-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[28px] font-extrabold tc">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, refresh } = usePoll(() => api<Dash>("/api/dashboard"), useCallback((d: Dash) => d.activeJobs.length > 0, []));
  const health = usePoll(() => api<Health>("/api/health"), useCallback(() => false, []));
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold">Dashboard</h1>
          <p className="mt-1 text-muted">Your projects, jobs and renders, straight from the server.</p>
        </div>
        <Link href="/projects" className="btn-primary">New project</Link>
      </div>

      {error && <div className="mt-6"><ErrorNote message={error} onRetry={refresh} /></div>}
      {!data && !error && <div className="mt-10"><Spinner /></div>}
      {data && (
        <>
          <section aria-label="Totals" className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Projects" value={data.stats.projects} />
            <Stat label="Videos uploaded" value={data.stats.uploads} />
            <Stat label="Videos analyzed" value={data.stats.videosAnalyzed} />
            <Stat label="Minutes processed" value={data.stats.minutesProcessed.toLocaleString("id-ID")} />
            <Stat label="Clips generated" value={data.stats.clips} />
            <Stat label="Jobs running" value={data.stats.activeJobs} />
            <Stat label="Tokens left" value={data.tokens.unlimited ? "Unlimited" : data.tokens.balance.toLocaleString("id-ID")} />
          </section>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <section aria-labelledby="active-h" className="card p-5">
              <h2 id="active-h" className="text-[18px] font-bold">Processing now</h2>
              {data.activeJobs.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">Nothing is processing. Upload a video in a project to start.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {data.activeJobs.map((j) => (
                    <li key={j.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{j.kind === "ANALYZE" ? `Analysis · ${j.sourceName ?? "video"}` : `Render · ${j.clipTitle ?? "clip"}`}</p>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full bg-system transition-[width] duration-500" style={{ width: `${j.progress}%` }} />
                        </div>
                      </div>
                      <StatusPill status={j.status} progress={j.progress} />
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="mt-8 text-[18px] font-bold">Latest renders</h2>
              {data.recentRenders.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">No finished renders yet.</p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.recentRenders.map((j) => (
                    <li key={j.id} className="rounded-ctl border border-line bg-surface2 px-3 py-2">
                      <Link href={`/studio/${j.clipId}`} className="block truncate text-[14px] font-medium hover:underline">{j.clipTitle}</Link>
                      <p className="text-[12px] text-muted tc">
                        {j.outputMeta?.video ? `${j.outputMeta.video.width}×${j.outputMeta.video.height}` : ""} · {fmtTime(j.outputMeta?.durationSec ?? null)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-col gap-6">
              <section aria-labelledby="svc-h" className="card p-5">
                <h2 id="svc-h" className="text-[18px] font-bold">Service status</h2>
                {!health.data ? (
                  <div className="mt-3">{health.error ? <ErrorNote message={health.error} /> : <Spinner label="Checking" />}</div>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {Object.entries(health.data.checks).map(([k, c]) => (
                      <li key={k} className="flex flex-wrap items-start gap-x-2 text-[13px]">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.ok ? "bg-system" : "bg-danger"}`} />
                        <span className="font-medium">{SERVICE_LABEL[k] ?? k}</span>
                        <span className="ml-auto text-right text-muted">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="act-h" className="card p-5">
                <h2 id="act-h" className="text-[18px] font-bold">Activity</h2>
                {data.activity.length === 0 ? (
                  <Empty title="No activity yet" />
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {data.activity.map((j) => (
                      <li key={j.id} className="flex items-center gap-2 text-[13px]">
                        <span className="tc text-faint">{new Date(j.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                        <span className="truncate">{j.kind === "ANALYZE" ? `Analyzed ${j.sourceName ?? "a video"}` : `Rendered ${j.clipTitle ?? "a clip"}`}</span>
                        <span className="ml-auto"><StatusPill status={j.status} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
