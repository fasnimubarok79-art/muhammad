"use client";

import Link from "next/link";
import { useCallback } from "react";
import { usePoll } from "@/hooks/usePoll";
import { api, fmtTime } from "@/lib/client";
import { Empty, ErrorNote, Spinner } from "../ui/bits";

type C = { id: string; title: string; hookText: string | null; startSec: number; endSec: number; hasThumbnail: boolean; _count: { segments: number }; project?: { title: string } };

/** Recent clips to open in the studio; used by the AI Video Editor and Subtitle Studio pages. */
export function ClipPicker({ cta, hrefFor, extra }: { cta: string; hrefFor: (id: string) => string; extra?: (c: C) => React.ReactNode }) {
  const { data, error, refresh } = usePoll(() => api<{ clips: C[] }>("/api/clips?sort=newest&pageSize=24"), useCallback(() => false, []));
  if (error) return <ErrorNote message={error} onRetry={refresh} />;
  if (!data) return <Spinner />;
  if (!data.clips.length) return <Empty title="Belum ada klip">Tempel link atau unggah video di Galeri Klip dulu.</Empty>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.clips.map((c) => (
        <li key={c.id} className="card flex gap-3 p-3">
          <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-[6px] bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.hasThumbnail && <img src={`/api/media/thumb/${c.id}`} alt="" className="h-full w-full object-cover" loading="lazy" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="line-clamp-2 text-[14px] font-semibold">{c.hookText ?? c.title}</p>
            <p className="mt-1 text-[12px] text-muted tc">{fmtTime(c.endSec - c.startSec, false)} · {c.project?.title}</p>
            {extra?.(c)}
            <Link href={hrefFor(c.id)} className="btn mt-auto h-8 w-fit border border-edit/60 bg-edit/10 px-3 text-[12px] text-edit hover:bg-edit/20">{cta}</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
