"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ClipGallery } from "@/components/app/ClipGallery";
import { ImportPanel } from "@/components/app/ImportPanel";
import { AccessBadge, ErrorNote, Spinner, StatusPill } from "@/components/ui/bits";
import { useToast } from "@/components/ui/use-toast";
import { usePoll } from "@/hooks/usePoll";
import { api, ClientApiError, fmtBytes, fmtTime } from "@/lib/client";

type Source = {
  id: string; kind: string; platform: string; sourceUrl: string | null; accessState: string; accessReason: string | null; originalName: string | null;
  durationSec: number | null; width: number | null; height: number | null; sizeBytes: number | null; hasMedia: boolean; createdAt: string;
  transcript: { language: string | null; engine: string } | null;
};
type Job = { id: string; kind: string; status: string; progress: number; error: string | null; sourceVideoId: string | null; createdAt: string; outputMeta: { note?: string; clips?: number } | null };
type Data = { project: { id: string; title: string }; sources: Source[]; jobs: Job[] };

const ACTIVE = ["queued", "validating", "downloading", "analyzing", "transcribing", "editing", "rendering"];

export default function ProjectPage({ params }: { params: { id: string } }) {
  const toast = useToast();
  const [galleryKey, setGalleryKey] = useState(0);
  const load = useCallback(async (): Promise<Data> => {
    const [p, j] = await Promise.all([api<Omit<Data, "jobs">>(`/api/projects/${params.id}`), api<{ jobs: Job[] }>(`/api/jobs?projectId=${params.id}&limit=50`)]);
    return { ...p, jobs: j.jobs };
  }, [params.id]);
  const { data, error, refresh } = usePoll(load, useCallback((d: Data) => d.jobs.some((j) => ACTIVE.includes(j.status)), []), 2000);

  const latestJob = (sourceId: string) => data?.jobs.find((j) => j.sourceVideoId === sourceId && j.kind === "ANALYZE");
  const onJobsChanged = () => {
    void refresh();
    setGalleryKey((k) => k + 1);
  };

  return (
    <AppShell>
      {error && <ErrorNote message={error} onRetry={refresh} />}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <h1 className="text-[28px] font-extrabold">{data.project.title}</h1>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
            <ImportPanel projectId={data.project.id} onChange={onJobsChanged} />
            <section aria-labelledby="src-h" className="card p-5">
              <h2 id="src-h" className="text-[18px] font-bold">Videos in this project</h2>
              {data.sources.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">No videos yet. Upload one or paste a link.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {data.sources.map((s) => {
                    const job = latestJob(s.id);
                    const running = job && ACTIVE.includes(job.status);
                    return (
                      <li key={s.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{s.originalName ?? s.sourceUrl ?? s.platform}</p>
                          <AccessBadge state={s.accessState} />
                        </div>
                        <p className="mt-1 text-[12px] text-muted tc">
                          {[s.durationSec ? fmtTime(s.durationSec, false) : null, s.width ? `${s.width}×${s.height}` : null, s.sizeBytes ? fmtBytes(s.sizeBytes) : null, s.transcript ? `transcript: ${s.transcript.language ?? "?"}` : null].filter(Boolean).join(" · ")}
                        </p>
                        {s.accessState !== "PROCESSABLE" && s.accessReason && <p className="mt-1 text-[12px] text-muted">{s.accessReason}</p>}
                        {s.hasMedia && (
                          <details className="mt-2">
                            <summary className="text-[12px] font-semibold text-muted hover:text-ink">Watch the original video</summary>
                            <video className="mt-2 max-h-[360px] w-full rounded-ctl bg-black" src={`/api/media/source/${s.id}`} controls preload="metadata" playsInline />
                          </details>
                        )}
                        {job && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusPill status={job.status} progress={job.progress} />
                            {job.error && <span className="text-[12px] text-danger">{job.error}</span>}
                            {job.outputMeta?.note && <span className="text-[12px] text-warn">{job.outputMeta.note}</span>}
                            {running && (
                              <button className="btn-ghost h-7 px-2 text-[12px]" onClick={async () => { await api(`/api/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => undefined); onJobsChanged(); }}>Cancel</button>
                            )}
                          </div>
                        )}
                        {s.hasMedia && !running && (
                          <button
                            className="btn-ghost mt-1 h-8 px-0 text-[12px]"
                            onClick={async () => {
                              try {
                                await api(`/api/sources/${s.id}/analyze`, { method: "POST" });
                                toast({ tone: "success", title: "Analysis queued", body: "Favourite and accepted clips are kept." });
                                onJobsChanged();
                              } catch (e) {
                                toast({ tone: "error", title: "Not queued", body: e instanceof ClientApiError ? e.body.message : undefined });
                              }
                            }}
                          >
                            Re-run AI analysis
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          <div className="mt-10">
            <ClipGallery projectId={data.project.id} refreshKey={galleryKey + data.jobs.filter((j) => j.status === "completed").length} />
          </div>
        </>
      )}
    </AppShell>
  );
}
