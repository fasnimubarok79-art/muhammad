"use client";

import { AppShell } from "@/components/app/AppShell";
import { ClipGallery } from "@/components/app/ClipGallery";
import { UrlBar } from "@/components/app/UrlBar";

export default function ViralPage() {
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Klip viral</h1>
      <p className="mt-1 text-muted">Klip dengan potensi viral tertinggi, diurutkan dari skor terbesar.</p>
      <div className="mt-6"><UrlBar /></div>
      <div className="mt-10"><ClipGallery viral title="Klip viral" /></div>
    </AppShell>
  );
}
