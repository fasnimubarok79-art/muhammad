"use client";

import { AppShell } from "@/components/app/AppShell";
import { ClipPicker } from "@/components/app/ClipPicker";

export default function SubtitleHub() {
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Subtitle Studio</h1>
      <p className="mt-1 max-w-2xl text-muted">
        Subtitle dibuat dari transkrip Whisper dengan timing per kata. Di studio Anda bisa mengedit teks dan waktu, split, menambah atau menghapus baris, memilih gaya (Karaoke, Pop, Impact, Clean), ukuran, warna, outline, bayangan dan posisi, serta impor/ekspor SRT dan VTT.
      </p>
      <h2 className="mt-8 text-[20px] font-bold">Pilih klip</h2>
      <div className="mt-4">
        <ClipPicker
          cta="Edit subtitle"
          hrefFor={(id) => `/studio/${id}`}
          extra={(c) => (
            <p className="mt-1 text-[12px] text-muted">
              {c._count.segments} baris ·{" "}
              <a className="underline underline-offset-2 hover:text-ink" href={`/api/clips/${c.id}/captions?format=srt`}>SRT</a>{" "}
              <a className="underline underline-offset-2 hover:text-ink" href={`/api/clips/${c.id}/captions?format=vtt`}>VTT</a>
            </p>
          )}
        />
      </div>
    </AppShell>
  );
}
