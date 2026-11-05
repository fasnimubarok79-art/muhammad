"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ErrorNote, Spinner } from "@/components/ui/bits";
import { api, fmtBytes, fmtTime } from "@/lib/client";
import type { AuditReport } from "@/lib/media/audit";

function Section({ title, basis, children }: { title: string; basis?: string; children: ReactNode }) {
  return (
    <section className="card min-w-0 p-5">
      <h2 className="text-[16px] font-bold">{title}</h2>
      {basis && <p className="mt-0.5 text-[12px] text-muted">{basis}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words tc">{v ?? <span className="text-muted">unknown</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One strip for the whole source: pauses, scene changes, clip candidates and B-roll windows. */
function MomentMap({ r }: { r: AuditReport }) {
  const d = r.file.durationSec || 1;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / d) * 100))}%`;
  const ticks = Array.from({ length: 6 }, (_, k) => (d * k) / 5);
  const lane = "relative h-6 rounded-[4px] bg-surface2";
  return (
    <div className="flex flex-col gap-1.5">
      {[
        ["Clips", <div key="c" className={lane}>{r.highlights.clips.map((c) => <span key={c.clipId} title={`${c.title} ${fmtTime(c.start, false)}–${fmtTime(c.end, false)}`} className="absolute inset-y-1 rounded-[3px] border border-edit/70 bg-edit/30" style={{ left: pct(c.start), width: pct(c.end - c.start) }} />)}</div>],
        ["B-roll", <div key="b" className={lane}>{r.broll.candidates.map((b, k) => <span key={k} title={`${fmtTime(b.start, false)}–${fmtTime(b.end, false)}`} className="absolute inset-y-1 rounded-[3px] bg-system/35" style={{ left: pct(b.start), width: pct(b.sec) }} />)}</div>],
        ["Pauses", <div key="p" className={lane}>{r.cutPoints.points.filter((p) => p.kind === "pause").map((p, k) => <span key={k} className="absolute inset-y-1 bg-danger/45" style={{ left: pct(p.t - p.sec / 2), width: `max(2px, ${pct(p.sec)})` }} />)}</div>],
        ["Scenes", <div key="s" className={lane}>{r.scenes.times.map((t, k) => <span key={k} className="absolute inset-y-0.5 w-px bg-ink/70" style={{ left: pct(t) }} />)}</div>],
      ].map(([label, el]) => (
        <div key={label as string} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-[11px] font-semibold text-muted">{label}</span>
          {el}
        </div>
      ))}
      <div className="ml-[5rem] flex justify-between text-[10px] text-faint tc" aria-hidden>
        {ticks.map((t) => <span key={t}>{fmtTime(t, false)}</span>)}
      </div>
    </div>
  );
}

export default function AuditPage({ params }: { params: { id: string; sourceId: string } }) {
  const [r, setR] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      setR((await api<{ report: AuditReport }>(`/api/sources/${params.sourceId}/audit`)).report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the report");
    }
  }, [params.sourceId]);
  useEffect(() => void load(), [load]);

  return (
    <AppShell>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${params.id}`} className="btn-ghost h-8 px-2 text-[12px]">← Project</Link>
        <h1 className="mr-auto min-w-0 truncate text-[24px] font-extrabold">Audit report{r ? `: ${r.file.name}` : ""}</h1>
        {r && <a className="btn-secondary h-9" href={`/api/sources/${params.sourceId}/audit?download=1`}>Download JSON</a>}
      </div>
      {error && <div className="mt-4"><ErrorNote message={error} onRetry={load} /></div>}
      {!r && !error && <Spinner label="Reading the video" />}
      {r && (
        <div className="mt-5 flex flex-col gap-5">
          {r.warnings.length > 0 && (
            <ul className="rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[13px]" role="status">
              {r.warnings.map((w) => <li key={w} className="py-0.5">{w}</li>)}
            </ul>
          )}

          <Section title="Moment map" basis="Where the clips, pauses, scene changes and B-roll windows fall in the whole video">
            <MomentMap r={r} />
          </Section>

          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Section title="File" basis={r.file.basis}>
              <Facts rows={[
                ["Duration", fmtTime(r.file.durationSec)],
                ["Resolution", r.file.width ? `${r.file.width}×${r.file.height}` : null],
                ["Aspect", r.file.aspect ? `${r.file.aspect.ratio} ${r.file.aspect.shape}` : null],
                ["Frame rate", r.file.fps ? `${r.file.fps} fps` : null],
                ["Video codec", r.file.videoCodec ? `${r.file.videoCodec}${r.file.pixelFormat ? ` (${r.file.pixelFormat})` : ""}` : null],
                ["Audio", r.file.audio ? [r.file.audio.codec, r.file.audio.sampleRate ? `${r.file.audio.sampleRate} Hz` : null, r.file.audio.channels ? `${r.file.audio.channels} ch` : null].filter(Boolean).join(" · ") || "present" : "none"],
                ["Container", r.file.container],
                ["Size", r.file.sizeBytes ? fmtBytes(r.file.sizeBytes) : null],
                ["Source", r.file.platform],
              ]} />
            </Section>

            <Section title="Speech" basis={r.speech?.basis}>
              {r.speech ? (
                <Facts rows={[
                  ["Language", r.speech.language],
                  ["Engine", r.speech.engine],
                  ["Words", r.speech.words],
                  ["Speaking time", `${fmtTime(r.speech.speechSec, false)} (${Math.round(r.speech.speechShare * 100)}% of the video)`],
                  ["Pace", `${r.speech.wordsPerMinute} words per minute`],
                  ["Low confidence", r.speech.lowConfidenceShare === null ? "not reported by the model" : `${r.speech.lowConfidenceWords} words (${Math.round(r.speech.lowConfidenceShare * 100)}%)`],
                  ["Longest gap", r.speech.longestGap.sec > 0 ? `${r.speech.longestGap.sec}s at ${fmtTime(r.speech.longestGap.start, false)}` : "none"],
                  ["Subtitle lines", `${r.subtitles.lines} in ${r.subtitles.clipsWithSubtitles} clips`],
                ]} />
              ) : <p className="text-[13px] text-muted">No transcript yet.</p>}
              {r.speech && r.speech.lowConfidenceSample.length > 0 && (
                <p className="mt-3 text-[12px] text-muted">
                  Check these words: {r.speech.lowConfidenceSample.map((x) => `“${x.w}” ${fmtTime(x.t, false)}`).join(", ")}
                </p>
              )}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Section title={`Pauses and scenes`} basis={`${r.silences.basis}. ${r.scenes.basis}.`}>
              <Facts rows={[
                ["Pauses", `${r.silences.count} (${fmtTime(r.silences.totalSec, false)} in total)`],
                ["Longest pause", r.silences.longest ? `${fmtTime(r.silences.longest.start, false)}–${fmtTime(r.silences.longest.end, false)}` : "none"],
                ["Scene changes", r.scenes.count],
                ["Average shot", `${r.scenes.averageShotSec}s`],
              ]} />
            </Section>
            <Section title={`Cut points (${r.cutPoints.count})`} basis={r.cutPoints.basis}>
              {r.cutPoints.count === 0 ? <p className="text-[13px] text-muted">No pauses of 0.6 s or more and no scene changes.</p> : (
                <ul className="flex flex-wrap gap-1.5">
                  {r.cutPoints.points.map((p, k) => (
                    <li key={k} className={`rounded-[4px] border px-1.5 py-0.5 text-[12px] tc ${p.kind === "scene" ? "border-line text-ink" : "border-danger/40 text-muted"}`} title={p.kind === "pause" ? `${p.sec}s pause` : "scene change"}>
                      {fmtTime(p.t, false)} {p.kind === "scene" ? "scene" : "pause"}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title={`Highlight candidates (${r.highlights.count})`} basis={r.highlights.basis}>
            {r.highlights.count === 0 ? <p className="text-[13px] text-muted">No clip candidates yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="text-[12px] text-muted"><tr><th className="py-1.5 pr-3 font-medium">Clip</th><th className="pr-3 font-medium">Time</th><th className="pr-3 font-medium">Score</th><th className="pr-3 font-medium">Why</th><th /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {r.highlights.clips.map((c) => (
                      <tr key={c.clipId} className="align-top">
                        <td className="max-w-[16rem] py-2 pr-3"><p className="font-medium">{c.title}</p>{c.hook && <p className="mt-0.5 text-[12px] text-muted">“{c.hook}”</p>}</td>
                        <td className="whitespace-nowrap py-2 pr-3 tc">{fmtTime(c.start, false)}–{fmtTime(c.end, false)}<span className="block text-[12px] text-muted">{c.sec}s</span></td>
                        <td className="py-2 pr-3 tc">{c.score ?? "–"}</td>
                        <td className="py-2 pr-3 text-[12px] text-muted">{c.why ?? "–"}</td>
                        <td className="py-2"><Link className="btn-secondary h-8 px-2.5 text-[12px]" href={`/studio/${c.clipId}`}>Edit</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`B-roll candidates (${r.broll.count})`} basis={r.broll.basis}>
            {r.broll.count === 0 ? <p className="text-[13px] text-muted">No single shot of 8 s or more with speech.</p> : (
              <ul className="divide-y divide-line text-[13px]">
                {r.broll.candidates.map((b, k) => (
                  <li key={k} className="flex flex-wrap gap-x-3 py-2">
                    <span className="tc">{fmtTime(b.start, false)}–{fmtTime(b.end, false)} ({b.sec}s)</span>
                    <span className="min-w-0 flex-1 text-muted">{b.excerpt}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <p className="text-[12px] text-faint tc">Generated {new Date(r.generatedAt).toLocaleString()}</p>
        </div>
      )}
    </AppShell>
  );
}
