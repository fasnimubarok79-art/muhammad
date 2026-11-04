"use client";

import { AppShell } from "@/components/app/AppShell";
import { ClipPicker } from "@/components/app/ClipPicker";

const READY = ["Timeline: trim, playhead, zoom, snap", "Split subtitle (S), undo/redo 50 langkah, autosave", "Crop, Fit+blur, Follow face, rasio 9:16 / 1:1 / 16:9", "6 preset look (termasuk Viral Spotlight), zoom dinamis, color grading", "Silence removal, normalisasi audio", "Export 450p / 720p / 1080p dengan verifikasi ffprobe"];

export default function EditorHub() {
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">AI Video Editor</h1>
      <p className="mt-1 max-w-2xl text-muted">Editor bekerja per klip. Pilih klip untuk membuka timeline, preview dan export.</p>
      <div className="mt-6 max-w-2xl">
        <section className="card p-4">
          <h2 className="font-sans text-[14px] font-semibold" style={{ fontStretch: "100%" }}>Yang bisa dilakukan di editor</h2>
          <ul className="mt-2 space-y-1 text-[13px] text-muted">{READY.map((x) => <li key={x}>✓ {x}</li>)}</ul>
        </section>
      </div>
      <h2 className="mt-10 text-[20px] font-bold">Pilih klip</h2>
      <div className="mt-4"><ClipPicker cta="Buka di editor" hrefFor={(id) => `/studio/${id}`} /></div>
    </AppShell>
  );
}
