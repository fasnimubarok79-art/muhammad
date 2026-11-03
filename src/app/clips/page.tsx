"use client";

import { AppShell } from "@/components/app/AppShell";
import { ClipGallery } from "@/components/app/ClipGallery";
import { UrlBar } from "@/components/app/UrlBar";

export default function ClipsPage() {
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Galeri klip</h1>
      <p className="mt-1 text-muted">Semua klip dari semua proyek Anda.</p>
      <div className="mt-6"><UrlBar /></div>
      <div className="mt-10"><ClipGallery title="Klip" /></div>
    </AppShell>
  );
}
